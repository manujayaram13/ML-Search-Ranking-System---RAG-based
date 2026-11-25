'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import CinematicBackground from '@/components/CinematicBackground'

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
  segment_count?: number
  embedding_count?: number
}

export default function Explorer() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  const loadAssetsData = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/assets', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || `Failed to load explorer assets (${res.status})`)
      }

      setErrorMsg('')
      setAssets(data.assets || [])
      setMediaUrls(data.mediaUrls || {})
    } catch (err: any) {
      console.error('Failed to load explorer assets:', err)
      setErrorMsg(err?.message || 'Failed to load assets from database.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadAssetsData(false)
    const interval = setInterval(() => loadAssetsData(true), 6000)
    return () => clearInterval(interval)
  }, [])

  const totalAssets = assets.length
  const readyAssets = assets.filter(a => a.status === 'ready').length
  const totalSegments = assets.reduce((acc, a) => acc + (a.segment_count || 0), 0)
  const totalEmbeddings = assets.reduce((acc, a) => acc + (a.embedding_count || 0), 0)

  const filteredAssets = assets.filter(asset => {
    const matchesType = selectedTypeFilter === 'all' || asset.file_type === selectedTypeFilter
    const q = searchQuery.toLowerCase().trim()
    const matchesSearch = !q || 
      asset.original_name.toLowerCase().includes(q) ||
      asset.file_type.toLowerCase().includes(q)
    return matchesType && matchesSearch
  })

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getMediaUrl = (fileType: string, filePath: string) => {
    if (!filePath) return ''
    const bucket = fileType === 'image' ? 'images' : fileType === 'video' ? 'videos' : 'documents'
    const key = `${bucket}:${filePath}`
    return mediaUrls[key] || ''
  }

  return (
    <div className="relative min-h-screen text-slate-100 font-sans pb-24 selection:bg-indigo-500/30 selection:text-indigo-200">
      <CinematicBackground isRerankMode={true} />

      {/* Top Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl bg-white/[0.02] border-b border-white/[0.12] transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.2)]">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3.5 group cursor-pointer">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center font-bold text-white shadow-xl shadow-purple-500/30 group-hover:scale-110 group-hover:rotate-6 transition-all">
              <span className="text-xl">🗂️</span>
            </div>
            <div>
              <span className="font-black text-xl bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent tracking-tight">
                Database Explorer
              </span>
              <span className="block text-[11px] font-mono text-slate-400 tracking-wider">
                Full Transparent Vector Grid
              </span>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <Link
              href="/"
              className="px-4 py-2 text-xs font-bold rounded-2xl text-slate-300 hover:text-white transparent-glass-button transition"
            >
              Upload & Search Studio
            </Link>
            <Link
              href="/explorer"
              className="px-4 py-2 text-xs font-bold rounded-2xl bg-indigo-500/20 text-indigo-200 border border-indigo-400/40 transition shadow-sm"
            >
              Main Files
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-10 space-y-10">
        {/* Page Title */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-2">
              <span>Main Media Assets</span>
              <span className="text-2xl animate-cute-drift">✨</span>
            </h1>
            <p className="text-slate-300/80 text-sm mt-1">
              Select any original media file to inspect its extracted chunks, OCR text, captions, transcripts, and vector embeddings.
            </p>
          </div>

          <button
            onClick={() => loadAssetsData(false)}
            disabled={loading}
            className="self-start md:self-auto px-5 py-3 transparent-glass-button text-white rounded-2xl text-xs font-bold transition flex items-center gap-2 active:scale-95"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? 'Refreshing...' : 'Refresh Files'}
          </button>
        </div>

        {/* Stats Dashboard Transparent Glass Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="transparent-glass rounded-3xl p-6 shadow-xl space-y-2">
            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Files</div>
            <div className="text-3xl sm:text-4xl font-black text-white">{totalAssets}</div>
            <div className="text-slate-300 text-xs">{readyAssets} Ready for Search</div>
          </div>

          <div className="transparent-glass rounded-3xl p-6 shadow-xl space-y-2">
            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Extracted Segments</div>
            <div className="text-3xl sm:text-4xl font-black text-indigo-300">{totalSegments}</div>
            <div className="text-slate-300 text-xs">Chunks, Captions & Keyframes</div>
          </div>

          <div className="transparent-glass rounded-3xl p-6 shadow-xl space-y-2">
            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Vector Embeddings</div>
            <div className="text-3xl sm:text-4xl font-black text-purple-300">{totalEmbeddings}</div>
            <div className="text-slate-300 text-xs">Jina AI (1024-d)</div>
          </div>

          <div className="transparent-glass rounded-3xl p-6 shadow-xl space-y-2">
            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Active Modalities</div>
            <div className="text-3xl sm:text-4xl font-black text-emerald-300">3 Types</div>
            <div className="text-slate-300 text-xs">Documents, Images & Videos</div>
          </div>
        </div>

        {/* Filters & Search Transparent Glass Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 transparent-glass p-4 rounded-3xl shadow-xl">
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {['all', 'document', 'image', 'video'].map(filter => (
              <button
                key={filter}
                onClick={() => setSelectedTypeFilter(filter)}
                className={`px-4 py-2 rounded-2xl text-xs font-bold capitalize transition-all duration-300 whitespace-nowrap ${
                  selectedTypeFilter === filter
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 border border-indigo-400/50'
                    : 'transparent-glass-button text-slate-300 hover:text-white'
                }`}
              >
                {filter === 'all' ? 'All Files' : `${filter}s`}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="Filter by filename..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full transparent-glass-input rounded-2xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-2.5 text-slate-400 hover:text-white text-xs font-bold"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Error Banner */}
        {errorMsg && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/50 px-5 py-4 text-xs text-rose-200 font-medium">
            Database Error: {errorMsg}
          </div>
        )}

        {/* Main Files Grid */}
        {filteredAssets.length === 0 ? (
          <div className="transparent-glass rounded-3xl p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.08] border border-white/20 flex items-center justify-center mx-auto mb-4 text-slate-300 text-2xl shadow-inner">
              📂
            </div>
            <h3 className="text-lg font-bold text-white">No media files found</h3>
            <p className="text-slate-300 text-sm mt-1">Upload a file from the Search Studio or clear filter terms.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAssets.map(asset => {
              const isImage = asset.file_type === 'image'
              const isVideo = asset.file_type === 'video'
              const isDoc = asset.file_type === 'document'
              const mediaUrl = getMediaUrl(asset.file_type, asset.file_path)

              return (
                <div
                  key={asset.id}
                  className="transparent-glass-card rounded-3xl overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    {/* Media Preview Box */}
                    <div className="bg-black/35 border-b border-white/[0.12] p-3.5 flex items-center justify-center min-h-[190px] max-h-[220px] relative overflow-hidden">
                      {isImage && mediaUrl ? (
                        <img
                          src={mediaUrl}
                          alt={asset.original_name}
                          className="max-h-48 w-full object-contain rounded-2xl shadow-md transition-transform duration-500 hover:scale-105"
                        />
                      ) : isVideo && mediaUrl ? (
                        <video
                          src={mediaUrl}
                          controls
                          className="max-h-48 w-full rounded-2xl border border-white/20 shadow-md"
                        />
                      ) : (
                        <div className="text-center p-6 space-y-2">
                          <div className="text-5xl mb-2 drop-shadow-md">📄</div>
                          <div className="text-xs text-slate-200 font-bold truncate max-w-[200px]">{asset.original_name}</div>
                          <div className="text-[11px] text-slate-400 font-medium">Document File</div>
                        </div>
                      )}

                      {/* Status Badge */}
                      <div className="absolute top-3 right-3">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider backdrop-blur-2xl border shadow ${
                          asset.status === 'ready' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/70 shadow-emerald-950/50' :
                          asset.status === 'failed' ? 'bg-rose-950/80 text-rose-300 border-rose-500/70 shadow-rose-950/50' :
                          'bg-amber-950/80 text-amber-300 border-amber-500/70 shadow-amber-950/50'
                        }`}>
                          {asset.status}
                        </span>
                      </div>
                    </div>

                    {/* File Details */}
                    <div className="p-5 space-y-3">
                      <div className="flex items-center gap-2.5">
                        <span className={`p-2 rounded-xl text-base shadow-sm ${
                          isImage ? 'bg-purple-500/20 text-purple-200 border border-purple-400/40' :
                          isVideo ? 'bg-pink-500/20 text-pink-200 border border-pink-400/40' :
                          'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                        }`}>
                          {isImage ? '🖼️' : isVideo ? '🎥' : '📄'}
                        </span>
                        <h3 className="font-bold text-white text-sm truncate" title={asset.original_name}>
                          {asset.original_name}
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center justify-between text-xs text-slate-300 font-mono bg-black/30 p-3 rounded-2xl border border-white/10">
                        <span>Size: <strong className="text-white">{formatFileSize(asset.file_size)}</strong></span>
                        <span>Type: <strong className="text-indigo-300 capitalize">{asset.file_type}</strong></span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-300 px-1">
                        <span>Extracted Segments:</span>
                        <span className="font-bold text-indigo-300">{asset.segment_count || 0} items</span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-300 px-1">
                        <span>Vector Embeddings:</span>
                        <span className="font-bold text-purple-300">{asset.embedding_count || 0} vectors</span>
                      </div>
                    </div>
                  </div>

                  {/* Card Bottom CTA */}
                  <div className="p-5 pt-0">
                    <Link
                      href={`/explorer/${asset.id}`}
                      className="w-full bg-indigo-600/30 hover:bg-indigo-600 text-indigo-100 hover:text-white text-xs font-bold py-3 px-4 rounded-2xl border border-indigo-400/40 hover:border-indigo-400 transition-all duration-300 flex items-center justify-center gap-2 group shadow-md active:scale-95"
                    >
                      <span>Inspect Segments & Vectors</span>
                      <span className="group-hover:translate-x-1.5 transition-transform">➔</span>
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
