'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import CinematicBackground from '@/components/CinematicBackground'

type Embedding = {
  id: string
  segment_id: string
  embedding_type: string
  embedding: number[] | string
  created_at?: string
}

type Segment = {
  id: string
  asset_id: string
  segment_type: string
  content: string
  importance_score: number | null
  chunk_index: number | null
  metadata: any
  created_at: string
  embeddings?: Embedding[]
}

type Asset = {
  id: string
  filename: string
  original_name: string
  file_type: string
  mime_type: string
  file_path: string
  file_size: number
  status: string
  error_message: string | null
  created_at: string
  segments?: Segment[]
}

function cleanVisionText(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  
  const finalMatch = s.match(/(?:Final (?:Polish|Output|Result|Description|Caption)|Caption|Description):\s*([\s\S]+)/i)
  if (finalMatch && finalMatch[1].trim().length > 10) {
    s = finalMatch[1].trim()
  }

  s = s.replace(/^(?:The user wants|Here is|Sure|Below is)[\s\S]*?(?=\n\n|\n[A-Z]|$)/i, '').trim()

  const lines = s.split('\n')
  const cleanLines = lines.filter(line => {
    const trimmed = line.trim()
    if (/^\d+\.\s*\*\*Analyze/i.test(trimmed)) return false
    if (/^(\*|\-)\s*\*\*[A-Za-z\s]+:\*\*/.test(trimmed)) return false
    if (/^\*\*[A-Za-z\s]+:\*\*/.test(trimmed) && trimmed.length < 50) return false
    if (/^(Plan|Drafting|Thinking|Key Points|Constraints):/i.test(trimmed)) return false
    if (/^(Analyze the image|Describe the|Step \d)/i.test(trimmed)) return false
    return true
  })

  return cleanLines.join('\n').trim()
}

export default function AssetDetail() {
  const params = useParams()
  const router = useRouter()
  const assetId = params?.id as string

  const [asset, setAsset] = useState<Asset | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [keyframeUrls, setKeyframeUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<boolean>(true)
  const [rawJsonModal, setRawJsonModal] = useState<boolean>(false)

  const loadAssetDetails = async () => {
    if (!assetId) return
    setLoading(true)

    try {
      const { data: assetData, error: assetErr } = await supabase
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .single()

      if (assetErr || !assetData) {
        console.error('Asset fetch error:', assetErr)
        setLoading(false)
        return
      }

      const { data: segsData, error: segsErr } = await supabase
        .from('segments')
        .select('*')
        .eq('asset_id', assetId)
        .order('created_at', { ascending: true })

      if (segsErr) throw segsErr

      const segments = segsData || []
      const segmentIds = segments.map(s => s.id)

      let embeddingsData: any[] = []
      if (segmentIds.length > 0) {
        const { data: embData, error: embErr } = await supabase
          .from('embeddings')
          .select('*')
          .in('segment_id', segmentIds)

        if (!embErr && embData) {
          embeddingsData = embData
        }
      }

      const embMap = new Map<string, Embedding[]>()
      embeddingsData.forEach(e => {
        const list = embMap.get(e.segment_id) || []
        list.push(e)
        embMap.set(e.segment_id, list)
      })

      const enrichedSegments: Segment[] = segments.map(s => ({
        ...s,
        embeddings: embMap.get(s.id) || []
      }))

      setAsset({
        ...assetData,
        segments: enrichedSegments
      })

      if (assetData.file_path) {
        const bucket = assetData.file_type === 'image' ? 'images' : assetData.file_type === 'video' ? 'videos' : 'documents'
        try {
          const { data: signedData } = await supabase.storage.from(bucket).createSignedUrl(assetData.file_path, 7200)
          setMediaUrl(signedData?.signedUrl || '')
        } catch (e) {
          const { data: pubData } = supabase.storage.from(bucket).getPublicUrl(assetData.file_path)
          setMediaUrl(pubData?.publicUrl || '')
        }
      }

      const kfUrls: Record<string, string> = {}
      for (const seg of enrichedSegments) {
        if (seg.segment_type === 'keyframe' && seg.metadata?.media_path) {
          const path = seg.metadata.media_path
          try {
            const { data } = await supabase.storage.from('keyframes').createSignedUrl(path, 7200)
            if (data?.signedUrl) kfUrls[path] = data.signedUrl
          } catch (e) {
            const { data: pubData } = supabase.storage.from('keyframes').getPublicUrl(path)
            if (pubData?.publicUrl) kfUrls[path] = pubData.publicUrl
          }
        }
      }
      setKeyframeUrls(kfUrls)

    } catch (err) {
      console.error('Failed to load asset details:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssetDetails()
  }, [assetId])

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatTimestamp = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined) return 'N/A'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const parseVectorPreview = (embedding: number[] | string | undefined) => {
    if (!embedding) return 'No vector'
    let vecArray: number[] = []
    if (Array.isArray(embedding)) {
      vecArray = embedding
    } else if (typeof embedding === 'string') {
      try {
        vecArray = JSON.parse(embedding)
      } catch (e) {
        return embedding.slice(0, 50) + '...'
      }
    }
    if (vecArray.length === 0) return 'Empty vector'
    const preview = vecArray.slice(0, 6).map(n => typeof n === 'number' ? n.toFixed(4) : n).join(', ')
    return `[${preview}, ... ${vecArray.length} dimensions]`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center p-6">
        <CinematicBackground isRerankMode={true} />
        <div className="text-center space-y-4 transparent-glass p-8 rounded-3xl relative z-10">
          <div className="w-10 h-10 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto shadow-[0_0_15px_rgba(99,102,241,0.6)]" />
          <p className="text-white text-sm font-semibold">Loading media segments and vector details...</p>
        </div>
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center p-6">
        <CinematicBackground isRerankMode={true} />
        <div className="text-center space-y-4 max-w-md transparent-glass p-9 rounded-3xl relative z-10">
          <div className="text-5xl animate-cute-drift">⚠️</div>
          <h2 className="text-2xl font-bold text-white">Asset Not Found</h2>
          <p className="text-slate-300 text-sm">The requested file could not be loaded from the database.</p>
          <Link
            href="/explorer"
            className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition shadow-lg shadow-indigo-600/30 active:scale-95"
          >
            ← Back to Explorer
          </Link>
        </div>
      </div>
    )
  }

  const segments = asset.segments || []
  const totalEmbeddings = segments.reduce((acc, s) => acc + (s.embeddings?.length || 0), 0)

  return (
    <div className="relative min-h-screen text-slate-100 font-sans pb-24 selection:bg-indigo-500/30 selection:text-indigo-200">
      <CinematicBackground isRerankMode={true} />

      {/* Top Navbar Full Transparent Glass */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl bg-white/[0.02] border-b border-white/[0.12] transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.2)]">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/explorer"
              className="flex items-center gap-2 text-xs font-bold text-white transparent-glass-button px-4 py-2 rounded-2xl transition"
            >
              ← Back to Explorer
            </Link>
            <span className="text-slate-500">/</span>
            <span className="font-bold text-sm text-slate-200 truncate max-w-md">
              {asset.original_name}
            </span>
          </div>

          <nav className="flex items-center gap-3">
            <button
              onClick={() => setRawJsonModal(true)}
              className="px-4 py-2 transparent-glass-button text-white rounded-2xl text-xs font-bold transition"
            >
              Inspect JSON Tree
            </button>
            <Link
              href="/"
              className="px-4 py-2 text-xs font-bold rounded-2xl text-slate-300 hover:text-white transparent-glass-button transition"
            >
              Search Studio
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-10 space-y-10">
        {/* Header Breadcrumb & Title */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-indigo-300 font-bold uppercase tracking-wider mb-1">
              <span>{asset.file_type} File Inspector</span>
              <span>•</span>
              <span>{segments.length} Extracted Segments</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-2">
              <span>{asset.original_name}</span>
              <span className="text-2xl animate-cute-drift">✨</span>
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider backdrop-blur-2xl border ${
              asset.status === 'ready' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/70 shadow-lg shadow-emerald-950/40' :
              asset.status === 'failed' ? 'bg-rose-950/80 text-rose-300 border-rose-500/70 shadow-lg shadow-rose-950/40' :
              'bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-lg shadow-amber-950/40'
            }`}>
              {asset.status}
            </span>

            {mediaUrl && (
              <a
                href={mediaUrl}
                target="_blank"
                rel="noreferrer"
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/40 active:scale-95"
              >
                <span>Open File In New Tab</span>
                <span>↗</span>
              </a>
            )}
          </div>
        </div>

        {/* Section 1: Main File Record & Media Preview Transparent Glass */}
        <div className="transparent-glass rounded-3xl p-7 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/[0.12] pb-3">
            <h3 className="text-xs font-black text-indigo-300 uppercase tracking-wider">
              1. Original File Record (`assets` table) & Storage Preview
            </h3>
            <span className="text-xs text-slate-400 font-mono">ID: {asset.id}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* Media Player Box */}
            <div className="bg-black/35 border border-white/[0.12] rounded-2xl p-4 flex flex-col items-center justify-center min-h-[220px]">
              {asset.file_type === 'image' && mediaUrl ? (
                <img
                  src={mediaUrl}
                  alt={asset.original_name}
                  className="max-h-64 max-w-full rounded-xl object-contain border border-white/20 shadow-md"
                />
              ) : asset.file_type === 'video' && mediaUrl ? (
                <video
                  src={mediaUrl}
                  controls
                  className="max-h-64 max-w-full rounded-xl border border-white/20 shadow-md"
                />
              ) : (
                <div className="text-center p-6 space-y-2">
                  <div className="text-5xl mb-2 drop-shadow-md">📄</div>
                  <div className="text-sm text-slate-100 font-bold">{asset.original_name}</div>
                  <div className="text-xs text-slate-400 font-mono">{asset.mime_type}</div>
                </div>
              )}
            </div>

            {/* Metadata Fields Box */}
            <div className="lg:col-span-2 bg-black/30 border border-white/[0.1] rounded-2xl p-6 text-xs font-mono grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><span className="text-slate-400">Original Filename:</span> <br/><span className="text-white font-semibold">{asset.original_name}</span></div>
              <div><span className="text-slate-400">File Type & Modality:</span> <br/><span className="text-indigo-300 capitalize font-bold">{asset.file_type}</span></div>
              <div><span className="text-slate-400">Storage Bucket Path:</span> <br/><span className="text-slate-200 break-all">{asset.file_path}</span></div>
              <div><span className="text-slate-400">MIME Content Type:</span> <br/><span className="text-slate-200">{asset.mime_type || 'N/A'}</span></div>
              <div><span className="text-slate-400">File Size:</span> <br/><span className="text-slate-200">{formatFileSize(asset.file_size)}</span></div>
              <div><span className="text-slate-400">Upload Timestamp:</span> <br/><span className="text-slate-200">{new Date(asset.created_at).toLocaleString()}</span></div>
              <div><span className="text-slate-400">Total Extracted Segments:</span> <br/><span className="text-indigo-300 font-bold">{segments.length} records</span></div>
              <div><span className="text-slate-400">Total Vectors Stored:</span> <br/><span className="text-purple-300 font-bold">{totalEmbeddings} vectors (1024-d)</span></div>
            </div>
          </div>
        </div>

        {/* Section 2: Extracted Sub-Things */}
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.12] pb-3">
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">Extracted Segments & Vector Embeddings</h2>
              <p className="text-slate-300/80 text-xs mt-0.5">
                All sub-chunks, captions, OCR text, transcripts, keyframe images, and 1024-d Jina vectors extracted from this file.
              </p>
            </div>
            <span className="text-xs font-bold text-indigo-200 bg-indigo-950/50 border border-indigo-400/50 px-3.5 py-1.5 rounded-xl self-start sm:self-auto backdrop-blur-2xl shadow-sm">
              {segments.length} Database Segments
            </span>
          </div>

          {segments.length === 0 ? (
            <div className="transparent-glass rounded-3xl p-14 text-center text-slate-400 text-sm">
              No segments or embeddings found for this asset.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {segments.map((seg, idx) => {
                const embeddings = seg.embeddings || []
                const meta = seg.metadata || {}
                const keyframeImgUrl = (seg.segment_type === 'keyframe' && meta.media_path) ? keyframeUrls[meta.media_path] : ''

                return (
                  <div
                    key={seg.id}
                    className="transparent-glass-card rounded-3xl p-6 sm:p-7 space-y-4 shadow-xl"
                  >
                    {/* Segment Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.1] pb-3.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                        
                        <span className={`px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider backdrop-blur-2xl border ${
                          seg.segment_type === 'marks_and_scores' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/70' :
                          seg.segment_type === 'document_summary' ? 'bg-teal-950/80 text-teal-300 border-teal-500/70' :
                          seg.segment_type === 'key_points' ? 'bg-yellow-950/80 text-yellow-300 border-yellow-500/70' :
                          seg.segment_type === 'caption' ? 'bg-purple-950/80 text-purple-300 border-purple-500/70' :
                          seg.segment_type === 'description' ? 'bg-indigo-950/80 text-indigo-300 border-indigo-500/70' :
                          seg.segment_type === 'ocr' ? 'bg-pink-950/80 text-pink-300 border-pink-500/70' :
                          seg.segment_type === 'keyframe' ? 'bg-amber-950/80 text-amber-300 border-amber-500/70' :
                          seg.segment_type === 'transcript_chunk' ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/70' :
                          'bg-blue-950/80 text-blue-300 border-blue-500/70'
                        }`}>
                          {seg.segment_type.replace(/_/g, ' ')}
                        </span>

                        {seg.chunk_index !== null && (
                          <span className="text-xs text-slate-300 font-mono">Chunk: #{seg.chunk_index}</span>
                        )}

                        {(meta.start_time !== undefined || meta.end_time !== undefined) && (
                          <span className="text-xs font-mono bg-cyan-950/60 text-cyan-300 px-3 py-1 rounded-xl border border-cyan-400/50">
                            ⏱️ {formatTimestamp(meta.start_time)} ➔ {formatTimestamp(meta.end_time)}
                          </span>
                        )}

                        {seg.importance_score !== null && (
                          <span className="text-xs text-slate-300 font-mono">Importance: {seg.importance_score}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-slate-400">Segment ID:</span>
                        <span className="text-indigo-300 font-bold">{seg.id}</span>
                      </div>
                    </div>

                    {/* Content Box */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
                      {keyframeImgUrl && (
                        <div className="md:col-span-1 bg-black/35 p-3 rounded-2xl border border-white/[0.1] flex flex-col items-center">
                          <img
                            src={keyframeImgUrl}
                            alt={seg.content}
                            className="max-h-40 max-w-full rounded-xl object-cover border border-white/20 shadow-md"
                          />
                          <span className="text-[10px] text-slate-400 mt-1 font-mono">Keyframe Frame</span>
                        </div>
                      )}

                      <div className={`${keyframeImgUrl ? 'md:col-span-3' : 'md:col-span-4'} bg-black/30 border border-white/[0.1] rounded-2xl p-4 text-xs text-slate-200 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed shadow-inner`}>
                        {cleanVisionText(seg.content)}
                      </div>
                    </div>

                    {/* Vector Embedding Table */}
                    <div className="bg-black/25 border border-white/[0.08] rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between text-xs font-bold text-purple-300 uppercase tracking-wider">
                        <span>Vector Embedding Record (`embeddings` table)</span>
                        <span>Jina AI (1024 dimensions)</span>
                      </div>

                      {embeddings.length === 0 ? (
                        <div className="text-xs text-slate-400 italic">No vector embedding found.</div>
                      ) : (
                        embeddings.map(emb => (
                          <div key={emb.id} className="bg-black/40 border border-white/[0.1] rounded-xl p-4 text-xs font-mono space-y-1.5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-slate-300">
                              <span>Embedding ID: <strong className="text-purple-300">{emb.id}</strong></span>
                              <span>Embedding Type: <strong className="text-white">{emb.embedding_type || 'text'}</strong></span>
                            </div>
                            <div className="text-slate-200 pt-2 border-t border-white/[0.08]">
                              <span className="text-slate-400">Vector Preview:</span>{' '}
                              <span className="text-emerald-300 font-bold">{parseVectorPreview(emb.embedding)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Raw JSON Inspection Modal */}
      {rawJsonModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="transparent-glass rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-white/20">
            <div className="p-5 border-b border-white/[0.1] flex items-center justify-between bg-black/40">
              <h3 className="font-bold text-white text-sm">
                Full Database JSON Tree — {asset.original_name}
              </h3>
              <button
                onClick={() => setRawJsonModal(false)}
                className="text-white text-xs px-3.5 py-1.5 transparent-glass-button rounded-xl"
              >
                Close
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 font-mono text-xs text-emerald-300 bg-black/60">
              <pre>{JSON.stringify(asset, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
