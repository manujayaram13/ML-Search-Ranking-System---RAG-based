'use client'

import { useState, useEffect, useRef } from 'react'
import { getBrowserSupabase } from '@/lib/supabase'
import Link from 'next/link'
import CinematicBackground from '@/components/CinematicBackground'

type Asset = {
  id: string
  original_name: string
  file_type: string
  status: string
  created_at: string
  error_message: string | null
}

type FileSearchResult = {
  asset_id: string
  original_name: string
  file_type: string
  file_path: string
  file_size: number
  media_url: string
  score: number
  rerank_score?: number
  stage1_score?: number
  reranked?: boolean
  start_time?: number | null
  end_time?: number | null
  answer?: string
  topSnippets?: string[]
  created_at: string
}

export default function Home() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [assets, setAssets] = useState<Asset[]>([])
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedModalityFilter, setSelectedModalityFilter] = useState<'all' | 'document' | 'image' | 'video'>('all')

  // XGBoost Reranker Toggle State
  const [useReranker, setUseReranker] = useState<boolean>(true)

  // Search by image state
  const [imageSearchFile, setImageSearchFile] = useState<File | null>(null)
  const [imageSearchPreview, setImageSearchPreview] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Selection & Delete state
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)

  // Load uploaded files history
  const loadAssets = async () => {
    try {
      const res = await fetch('/api/assets', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || data.error) {
        console.error('Failed to load assets:', data.error || res.statusText)
        return
      }
      setAssets(data.assets || [])
    } catch (err) {
      console.error('Failed to load assets:', err)
    }
  }

  useEffect(() => {
    loadAssets()
    const interval = setInterval(loadAssets, 4000)
    return () => clearInterval(interval)
  }, [])

  const handleSearch = async (targetRerankerState?: boolean) => {
    const activeReranker = targetRerankerState !== undefined ? targetRerankerState : useReranker

    if (imageSearchFile) {
      handleImageSearch(imageSearchFile, activeReranker)
      return
    }

    if (!query.trim()) return

    setSearching(true)
    setResults([])

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 12, useReranker: activeReranker })
      })

      const data = await res.json()
      setResults(data.results || [])
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setSearching(false)
    }
  }

  const handleImageSearch = async (imgFile: File, targetRerankerState?: boolean) => {
    const activeReranker = targetRerankerState !== undefined ? targetRerankerState : useReranker

    setSearching(true)
    setResults([])

    try {
      const formData = new FormData()
      formData.append('image', imgFile)
      formData.append('useReranker', String(activeReranker))

      const res = await fetch('/api/search-by-image', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()
      setResults(data.results || [])
      if (data.queryText) {
        setQuery(data.queryText)
      }
    } catch (err) {
      console.error('Image Search Error:', err)
    } finally {
      setSearching(false)
    }
  }

  const toggleReranker = () => {
    const nextState = !useReranker
    setUseReranker(nextState)

    if (results.length > 0) {
      if (nextState) {
        const sorted = [...results].sort((a, b) => (b.rerank_score || b.score) - (a.rerank_score || a.score))
        setResults(sorted.map(r => ({ ...r, reranked: true })))
      } else {
        const shuffled = [...results]
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }
        setResults(shuffled.map(r => ({ ...r, reranked: false })))
      }
    }
  }

  const onSelectSearchImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setImageSearchFile(selected)
      const previewUrl = URL.createObjectURL(selected)
      setImageSearchPreview(previewUrl)
      handleImageSearch(selected, useReranker)
    }
  }

  const clearImageSearch = () => {
    setImageSearchFile(null)
    if (imageSearchPreview) URL.revokeObjectURL(imageSearchPreview)
    setImageSearchPreview(null)
    if (imageInputRef.current) imageInputRef.current.value = ''
    setResults([])
    setQuery('')
  }

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return

    setUploading(true)
    setMessage(`Uploading and processing ${selectedFiles.length} file(s)...`)

    try {
      const client = await getBrowserSupabase()

      const uploadPromises = selectedFiles.map(async (f) => {
        let fileType = 'document'
        if (f.type.startsWith('image/')) fileType = 'image'
        if (f.type.startsWith('video/')) fileType = 'video'

        const fileExt = f.name.split('.').pop()
        const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
        const fileName = `${uniqueSuffix}.${fileExt}`
        const folder = fileType === 'document' ? 'documents' : fileType === 'image' ? 'images' : 'videos'
        const filePath = `${folder}/${fileName}`

        const { error: uploadError } = await client.storage
          .from(folder)
          .upload(filePath, f, {
            contentType: f.type || 'application/octet-stream',
          })

        if (uploadError) throw new Error(`${f.name}: ${uploadError.message}`)

        const { data: newAsset, error: dbError } = await client
          .from('assets')
          .insert({
            filename: fileName,
            original_name: f.name,
            file_type: fileType,
            mime_type: f.type || 'application/octet-stream',
            file_path: filePath,
            file_size: f.size,
            status: 'processing'
          })
          .select()
          .single()

        if (dbError) throw new Error(`${f.name}: ${dbError.message}`)

        let endpoint = '/api/process-document'
        if (fileType === 'image') endpoint = '/api/process-image'
        if (fileType === 'video') endpoint = '/api/process-video'

        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: newAsset.id })
        }).catch(err => console.error(`Background processing trigger failed for ${f.name}:`, err))

        return f.name
      })

      const uploadedNames = await Promise.all(uploadPromises)

      setMessage(`Successfully uploaded ${uploadedNames.length} file(s)! Extracting multimodal embeddings in background...`)
      setSelectedFiles([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      loadAssets()
    } catch (err: any) {
      console.error('Upload error:', err)
      setMessage('Upload error: ' + (err?.message || err))
    } finally {
      setUploading(false)
    }
  }

  const toggleSelectAsset = (id: string) => {
    setSelectedAssetIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (selectedAssetIds.length === assets.length) {
      setSelectedAssetIds([])
    } else {
      setSelectedAssetIds(assets.map(a => a.id))
    }
  }

  const handleDeleteSelected = async (targetIds?: string[]) => {
    const idsToDelete = targetIds || selectedAssetIds
    if (!idsToDelete || idsToDelete.length === 0) return

    const confirmMsg = idsToDelete.length === 1
      ? 'Are you sure you want to delete this file and all its embeddings/segments from the database?'
      : `Are you sure you want to delete ${idsToDelete.length} selected files and all their embeddings from the database?`

    if (!window.confirm(confirmMsg)) return

    setDeleting(true)
    setMessage('')

    try {
      const res = await fetch('/api/assets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: idsToDelete })
      })

      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setMessage(`Successfully deleted ${idsToDelete.length} file(s) and their vectors from database.`)
      setSelectedAssetIds(prev => prev.filter(id => !idsToDelete.includes(id)))
      setResults(prev => prev.filter(r => !idsToDelete.includes(r.asset_id)))
      await loadAssets()
    } catch (err: any) {
      console.error('Delete error:', err)
      setMessage('Delete failed: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatTimestamp = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined) return ''
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const jumpToTimestamp = (assetId: string, timestampSeconds: number) => {
    const videoEl = document.getElementById(`video-${assetId}`) as HTMLVideoElement | null
    if (videoEl) {
      videoEl.currentTime = timestampSeconds
      videoEl.play()
    }
  }

  const filteredResults = results.filter(item => {
    if (selectedModalityFilter === 'all') return true
    return item.file_type === selectedModalityFilter
  })

  const isRerankMode = useReranker

  return (
    <div className="relative min-h-screen text-slate-100 font-sans pb-24 selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Cinematic Background with Moon, Mountains, Flowing Waves, Meteors & Bubbles */}
      <CinematicBackground isRerankMode={isRerankMode} />

      {/* Top Navbar Full Transparent Glass */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl bg-white/[0.02] border-b border-white/[0.12] transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.25)]">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3.5 group cursor-pointer">
            <div
              className={`h-11 w-11 rounded-2xl flex items-center justify-center font-bold text-white shadow-xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-6 ${
                isRerankMode
                  ? 'bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 shadow-indigo-500/30'
                  : 'bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 shadow-amber-500/30'
              }`}
            >
              <span className="text-xl animate-cute-drift">{isRerankMode ? '🌙' : '✨'}</span>
            </div>
            <div>
              <span className="font-black text-xl bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent tracking-tight">
                Multimodal Studio
              </span>
              <span className="block text-[11px] font-mono text-slate-400 tracking-wider">
                Cinematic Neural Search
              </span>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <Link
              href="/"
              className={`px-4 py-2 text-xs font-bold rounded-2xl border transition-all duration-300 shadow-sm ${
                isRerankMode
                  ? 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40 hover:bg-indigo-500/30 shadow-indigo-500/20'
                  : 'bg-amber-500/20 text-amber-200 border-amber-400/40 hover:bg-amber-500/30 shadow-amber-500/20'
              }`}
            >
              Search & Upload
            </Link>
            <Link
              href="/explorer"
              className="px-4 py-2 text-xs font-bold rounded-2xl text-slate-300 hover:text-white transparent-glass-button transition"
            >
              Database Explorer
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 py-10 space-y-10">
        {/* Search Hero Full Transparent Glass Panel */}
        <div
          className={`rounded-3xl p-7 sm:p-9 relative overflow-hidden transition-all duration-500 ${
            isRerankMode ? 'transparent-glass' : 'transparent-glass-amber'
          }`}
        >
          {/* Subtle glossy top glare reflection */}
          <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-white/50 to-transparent pointer-events-none" />

          <div className="relative z-10 space-y-6">
            {/* Header and Toggle Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>Multimodal Search</span>
                  <span className="text-2xl animate-cute-drift">{isRerankMode ? '🔮' : '🎲'}</span>
                </h1>
                <p className="text-slate-300/80 text-sm mt-1.5 font-normal">
                  {isRerankMode
                    ? 'Deep neural retrieval with XGBoost Learning-to-Rank precision and timestamp jumping.'
                    : 'Unranked baseline retrieval returning matching documents in random candidate order.'}
                </p>
              </div>

              {/* High-Level Glass Switcher */}
              <div className="flex items-center p-1 rounded-2xl bg-black/30 backdrop-blur-2xl border border-white/20 shadow-inner self-start sm:self-auto">
                <button
                  type="button"
                  onClick={toggleReranker}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-2 ${
                    isRerankMode
                      ? 'bg-gradient-to-r from-indigo-500/40 via-purple-500/30 to-emerald-500/30 text-emerald-200 border border-emerald-400/50 shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                  title="Activate XGBoost Reranking"
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                      isRerankMode ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]' : 'bg-slate-600'
                    }`}
                  />
                  <span>With Reranking</span>
                </button>

                <button
                  type="button"
                  onClick={toggleReranker}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-2 ${
                    !isRerankMode
                      ? 'bg-gradient-to-r from-amber-500/40 to-rose-500/30 text-amber-200 border border-amber-400/50 shadow-md shadow-amber-500/20'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                  title="Deactivate Reranking for Random Retrieval"
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                      !isRerankMode ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]' : 'bg-slate-600'
                    }`}
                  />
                  <span>Without Reranking (Random)</span>
                </button>
              </div>
            </div>

            {/* Hidden File Input for Image Search */}
            <input
              type="file"
              ref={imageInputRef}
              accept="image/*"
              className="hidden"
              onChange={onSelectSearchImage}
            />

            {/* Active Image Search Banner */}
            {imageSearchPreview && (
              <div
                className={`flex items-center justify-between p-3.5 rounded-2xl text-xs border backdrop-blur-2xl transition-all duration-300 ${
                  isRerankMode
                    ? 'bg-indigo-950/30 border-indigo-400/40 text-indigo-100 shadow-xl shadow-indigo-950/20'
                    : 'bg-amber-950/30 border-amber-400/40 text-amber-100 shadow-xl shadow-amber-950/20'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <img
                    src={imageSearchPreview}
                    alt="Query Image"
                    className="w-12 h-12 object-cover rounded-xl border border-white/30 shadow-md"
                  />
                  <div>
                    <span className="font-bold text-sm block text-white">
                      Searching by Image: {imageSearchFile?.name}
                    </span>
                    <span className="text-[11px] opacity-80">
                      Visual concepts analyzed by Gemini Vision • Mode: {isRerankMode ? 'XGBoost Reranked' : 'Random Order'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={clearImageSearch}
                  className="px-3.5 py-1.5 transparent-glass-button text-slate-200 hover:text-white rounded-xl text-xs font-semibold"
                >
                  Clear Image
                </button>
              </div>
            )}

            {/* Search Input Bar with Glass Aesthetics */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-300 transition">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder={
                    imageSearchPreview
                      ? "Image query active..."
                      : "Ask anything (e.g. 'what is marks in the uploaded pdf?', 'beach sunset couple')..."
                  }
                  className="w-full transparent-glass-input rounded-2xl pl-11 pr-28 py-4 text-slate-100 placeholder-slate-400 text-sm focus:outline-none transition-all duration-300"
                />

                {/* Search from Image Button */}
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="absolute right-3 top-2.5 px-3 py-1.5 transparent-glass-button text-slate-200 hover:text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
                  title="Upload Image as Search Query"
                >
                  <span className="text-sm">📷</span>
                  <span className="hidden sm:inline">Image</span>
                </button>
              </div>

              {/* Main Search Action Button */}
              <button
                onClick={() => handleSearch()}
                disabled={searching || (!query.trim() && !imageSearchFile)}
                className={`px-8 py-4 rounded-2xl font-black text-sm text-white shadow-xl transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 ${
                  isRerankMode
                    ? 'bg-gradient-to-r from-indigo-500 via-blue-600 to-emerald-500 hover:from-indigo-400 hover:to-emerald-400 shadow-indigo-500/30 hover:shadow-indigo-500/50'
                    : 'bg-gradient-to-r from-amber-500 via-orange-600 to-rose-500 hover:from-amber-400 hover:to-rose-400 shadow-amber-500/30 hover:shadow-amber-500/50'
                }`}
              >
                {searching ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Searching...</span>
                  </>
                ) : (
                  <span>Search</span>
                )}
              </button>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-medium">Filter by:</span>
                {(['all', 'document', 'image', 'video'] as const).map((mod) => (
                  <button
                    key={mod}
                    onClick={() => setSelectedModalityFilter(mod)}
                    className={`px-4 py-2 rounded-xl capitalize font-bold transition-all duration-300 ${
                      selectedModalityFilter === mod
                        ? isRerankMode
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 border border-indigo-400/50'
                          : 'bg-amber-600 text-white shadow-lg shadow-amber-600/40 border border-amber-400/50'
                        : 'transparent-glass-button text-slate-300 hover:text-white'
                    }`}
                  >
                    {mod === 'all' ? 'All Files' : `${mod}s`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Search Results Grid */}
        {results.length > 0 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between text-xs text-slate-300 px-1 font-semibold">
              <span>
                Found <strong className="text-white">{filteredResults.length}</strong> matching file
                {filteredResults.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredResults.map((item, index) => {
                const isImage = item.file_type === 'image'
                const isVideo = item.file_type === 'video'
                const isDoc = item.file_type === 'document'
                const hasTimestamp = isVideo && item.start_time !== null && item.start_time !== undefined
                const isTop1 = index === 0 && isRerankMode

                return (
                  <div
                    key={item.asset_id}
                    className={`rounded-3xl overflow-hidden flex flex-col justify-between relative ${
                      isRerankMode ? 'transparent-glass-card' : 'transparent-glass-card-amber'
                    }`}
                  >
                    <div>
                      {/* Media Header Preview Box */}
                      <div className="bg-black/35 border-b border-white/[0.12] p-3.5 flex items-center justify-center min-h-[200px] max-h-[240px] relative overflow-hidden">
                        {isImage && item.media_url ? (
                          <img
                            src={item.media_url}
                            alt={item.original_name}
                            className="max-h-52 w-full object-contain rounded-2xl shadow-md transition-transform duration-500 hover:scale-105"
                          />
                        ) : isVideo && item.media_url ? (
                          <video
                            id={`video-${item.asset_id}`}
                            src={item.media_url}
                            controls
                            className="max-h-52 w-full rounded-2xl border border-white/20 shadow-md"
                          />
                        ) : (
                          <div className="text-center p-6 space-y-2">
                            <div className="text-5xl mb-2 drop-shadow-md">📄</div>
                            <div className="text-xs text-slate-200 font-bold truncate max-w-[200px]">
                              {item.original_name}
                            </div>
                            <div className="text-[11px] text-slate-400 font-medium">Document File</div>
                          </div>
                        )}

                        {/* Rank Badge Indicator (Top Left) - Only shown with Reranker */}
                        {isRerankMode && (
                          <div className="absolute top-3 left-3">
                            <span
                              className={`px-3 py-1 rounded-full text-[11px] font-black border backdrop-blur-2xl shadow-lg transition-all ${
                                isTop1
                                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-400/80 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                                  : 'bg-indigo-950/80 text-indigo-200 border-indigo-400/60 shadow-md'
                              }`}
                            >
                              {isTop1 ? '👑 #1 Most Relevant' : `#${index + 1} Rank`}
                            </span>
                          </div>
                        )}

                        {/* Match Percentage Tag (Top Right) - Only shown with Reranker */}
                        {isRerankMode && (
                          <div className="absolute top-3 right-3 backdrop-blur-2xl bg-black/60 border border-emerald-400/60 text-emerald-300 text-xs font-black px-3 py-1 rounded-full shadow-lg flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                            <span>{(item.score * 100).toFixed(1)}% Match</span>
                          </div>
                        )}
                      </div>

                      {/* File Details */}
                      <div className="p-5 space-y-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`p-2 rounded-xl text-base shadow-sm ${
                              isImage
                                ? 'bg-purple-500/20 text-purple-200 border border-purple-400/40'
                                : isVideo
                                ? 'bg-pink-500/20 text-pink-200 border border-pink-400/40'
                                : 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                            }`}
                          >
                            {isImage ? '🖼️' : isVideo ? '🎥' : '📄'}
                          </span>
                          <h3
                            className="font-bold text-white text-sm truncate flex-1"
                            title={item.original_name}
                          >
                            {item.original_name}
                          </h3>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-300 font-mono px-0.5">
                          <span className="capitalize font-semibold text-slate-200">{item.file_type}</span>
                          <span>{formatFileSize(item.file_size)}</span>
                        </div>

                        {/* Direct Answer / Relevant Excerpt */}
                        {item.answer && (
                          <div
                            className={`mt-3 p-4 rounded-2xl text-xs backdrop-blur-2xl shadow-inner border transition-all ${
                              isRerankMode
                                ? 'bg-indigo-950/20 border-indigo-400/30 text-slate-100 shadow-indigo-950/30'
                                : 'bg-amber-950/20 border-amber-400/30 text-stone-200 shadow-amber-950/30'
                            }`}
                          >
                            <p className="text-xs leading-relaxed whitespace-pre-wrap font-medium">
                              {item.answer}
                            </p>
                          </div>
                        )}

                        {/* Video Timestamp Match Badge & Jump Button */}
                        {hasTimestamp && (
                          <div className="mt-2 bg-cyan-950/30 backdrop-blur-2xl border border-cyan-400/40 p-2.5 rounded-2xl flex items-center justify-between text-xs">
                            <span className="text-cyan-200 font-mono font-medium">
                              ⏱ {formatTimestamp(item.start_time)}{' '}
                              {item.end_time ? `➔ ${formatTimestamp(item.end_time)}` : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => jumpToTimestamp(item.asset_id, item.start_time!)}
                              className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-[11px] font-bold transition shadow-md shadow-cyan-600/30 flex items-center gap-1 active:scale-95"
                            >
                              <span>Play from {formatTimestamp(item.start_time)}</span>
                              <span>▶</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="p-5 pt-0">
                      {item.media_url ? (
                        <a
                          href={item.media_url}
                          target="_blank"
                          rel="noreferrer"
                          className={`w-full py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all duration-300 border shadow-sm ${
                            isRerankMode
                              ? 'bg-indigo-600/30 hover:bg-indigo-600 text-indigo-100 hover:text-white border-indigo-400/40 hover:shadow-lg hover:shadow-indigo-600/40'
                              : 'bg-amber-600/30 hover:bg-amber-600 text-amber-100 hover:text-white border-amber-400/40 hover:shadow-lg hover:shadow-amber-600/40'
                          }`}
                        >
                          <span>Open Original File</span>
                          <span>↗</span>
                        </a>
                      ) : (
                        <div className="text-center text-xs text-slate-400 py-1 font-mono truncate">
                          {item.file_path}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {results.length === 0 && !searching && (query || imageSearchFile) && (
          <div
            className={`rounded-3xl p-12 text-center text-slate-300 ${
              isRerankMode ? 'transparent-glass' : 'transparent-glass-amber'
            }`}
          >
            <div className="text-4xl mb-3 animate-cute-drift">🔍</div>
            <h3 className="font-bold text-lg text-white">No matching files found</h3>
            <p className="text-sm text-slate-400 mt-1">
              Try another descriptive search query or upload new files to expand database.
            </p>
          </div>
        )}

        {/* Upload Box Full Transparent Glass */}
        <div className="transparent-glass rounded-3xl p-7 sm:p-9 shadow-2xl space-y-5">
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <span>Upload New Files</span>
              <span className="text-xl animate-cute-drift">📤</span>
            </h2>
            <p className="text-slate-300/80 text-sm mt-1">
              Supports PDF, DOCX, TXT documents, JPG/PNG images, and MP4/WebM videos. Automatically indexes embeddings in background.
            </p>
          </div>

          <div className="space-y-4 pt-1">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.doc,.docx,image/*,video/*"
                onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                className="text-sm text-slate-300 file:mr-4 file:py-3 file:px-5 file:rounded-2xl file:border-0 file:text-xs file:font-bold file:bg-white/15 file:text-white hover:file:bg-white/25 file:cursor-pointer cursor-pointer"
              />

              <button
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || uploading}
                className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white px-7 py-3.5 rounded-2xl font-bold text-sm disabled:opacity-50 transition shadow-lg shadow-indigo-600/30 whitespace-nowrap active:scale-95"
              >
                {uploading
                  ? `Uploading & Processing (${selectedFiles.length})...`
                  : selectedFiles.length > 1
                  ? `Upload ${selectedFiles.length} Files`
                  : 'Upload File'}
              </button>
            </div>

            {selectedFiles.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 font-mono bg-black/30 p-3 rounded-2xl border border-white/10">
                <span className="text-slate-400 font-bold">Selected ({selectedFiles.length} files):</span>
                {selectedFiles.map((f, i) => (
                  <span key={i} className="transparent-glass-button px-2.5 py-1 rounded-xl text-slate-200">
                    {f.name} ({formatFileSize(f.size)})
                  </span>
                ))}
              </div>
            )}
          </div>

          {message && (
            <p className="text-xs text-indigo-200 bg-indigo-950/40 border border-indigo-400/40 p-3.5 rounded-2xl font-mono backdrop-blur-2xl">
              {message}
            </p>
          )}
        </div>

        {/* Upload History & Database Asset Management */}
        <div className="transparent-glass rounded-3xl p-7 sm:p-9 shadow-2xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <span>Uploaded Assets History</span>
                <span className="text-xl animate-cute-drift">🗂️</span>
              </h2>
              <p className="text-xs text-slate-300/80 mt-0.5">Manage and delete records from database & storage</p>
            </div>

            <div className="flex items-center gap-3">
              {/* Batch Delete Action Button */}
              {selectedAssetIds.length > 0 && (
                <button
                  onClick={() => handleDeleteSelected()}
                  disabled={deleting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-xs font-bold transition shadow-lg shadow-rose-600/40 flex items-center gap-1.5 disabled:opacity-50 active:scale-95"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>{deleting ? 'Deleting...' : `Delete Selected (${selectedAssetIds.length})`}</span>
                </button>
              )}

              <Link
                href="/explorer"
                className="text-xs font-bold text-indigo-300 hover:text-white transparent-glass-button px-3.5 py-2 rounded-xl transition"
              >
                View Database Explorer →
              </Link>
            </div>
          </div>

          {/* Select All Bar */}
          {assets.length > 0 && (
            <div className="flex items-center justify-between bg-black/30 px-4 py-2.5 rounded-2xl border border-white/10 text-xs text-slate-300">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={assets.length > 0 && selectedAssetIds.length === assets.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded-lg bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                />
                <span className="font-semibold text-slate-200">
                  {selectedAssetIds.length === assets.length ? 'Deselect All' : 'Select All'} ({assets.length} items)
                </span>
              </label>

              {selectedAssetIds.length > 0 && (
                <span className="text-[11px] font-mono text-indigo-300 font-bold">
                  {selectedAssetIds.length} of {assets.length} selected
                </span>
              )}
            </div>
          )}

          {/* Asset List */}
          <div className="space-y-3">
            {assets.map((asset) => {
              const isSelected = selectedAssetIds.includes(asset.id)

              return (
                <div
                  key={asset.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl transition-all duration-300 border backdrop-blur-2xl ${
                    isSelected
                      ? 'bg-indigo-950/30 border-indigo-400/60 shadow-md shadow-indigo-950/40'
                      : 'bg-white/[0.02] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-3.5 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectAsset(asset.id)}
                      className="w-4 h-4 rounded-lg bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer shrink-0"
                    />

                    <span className="text-2xl shrink-0">
                      {asset.file_type === 'image' ? '🖼️' : asset.file_type === 'video' ? '🎥' : '📄'}
                    </span>

                    <div className="truncate">
                      <p className="font-bold text-white text-sm truncate" title={asset.original_name}>
                        {asset.original_name}
                      </p>
                      <p className="text-xs text-slate-400 capitalize mt-0.5">
                        {asset.file_type} • {new Date(asset.created_at).toLocaleString()}
                      </p>
                      {asset.status === 'failed' && asset.error_message && (
                        <p className="text-xs text-rose-400 font-mono mt-1 max-w-md">{asset.error_message}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border backdrop-blur-xl ${
                        asset.status === 'ready'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/70'
                          : asset.status === 'failed'
                          ? 'bg-rose-950/80 text-rose-300 border-rose-600/70'
                          : 'bg-amber-950/80 text-amber-300 border-amber-600/70'
                      }`}
                    >
                      {asset.status}
                    </span>

                    {/* Single Item Delete Button */}
                    <button
                      onClick={() => handleDeleteSelected([asset.id])}
                      disabled={deleting}
                      className="p-2 text-slate-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-xl transition"
                      title="Delete this file from database"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}

            {assets.length === 0 && (
              <p className="text-slate-400 text-sm py-2">No files uploaded yet.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}