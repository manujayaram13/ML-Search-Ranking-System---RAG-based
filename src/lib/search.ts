import { supabase } from './supabase'
import { answerSemanticQueryWithGemini, extractAnswersForResultsWithGemini } from './gemini'
import { rerankCandidatesWithXGBoost } from './reranker'

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text.slice(0, 8000)],
      task: 'retrieval.query'
    })
  })

  if (!response.ok) {
    throw new Error(`Jina embedding failed: ${await response.text()}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

export async function search(query: string, limit = 12, useReranker = true) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return []
  }

  const queryEmbedding = await getEmbedding(query)
  let rawSegmentMatches: any[] = []

  // 1. Try Supabase RPC match_segments
  try {
    const { data, error } = await supabase.rpc('match_segments', {
      query_embedding: queryEmbedding,
      query_text: query,
      match_count: 50
    })

    if (!error && data && Array.isArray(data) && data.length > 0) {
      rawSegmentMatches = data
    }
  } catch (err: any) {
    console.warn('RPC invocation failed:', err?.message || err)
  }

  // 2. Hybrid Fallback: Direct vector query + cosine similarity
  if (rawSegmentMatches.length === 0) {
    const { data: embs, error: embsError } = await supabase
      .from('embeddings')
      .select(`
        id,
        segment_id,
        embedding,
        segments (
          id,
          asset_id,
          segment_type,
          content,
          start_time,
          end_time,
          importance_score,
          metadata,
          assets (
            id,
            file_type,
            original_name,
            file_path,
            file_size,
            created_at,
            status
          )
        )
      `)

    if (embsError || !embs) {
      console.error('Vector search fallback error:', embsError)
      return []
    }

    const queryLower = query.toLowerCase().trim()
    const queryKeywords = queryLower.split(/\s+/).filter(w => w.length > 2)

    for (const row of embs as any[]) {
      const segment = row.segments
      if (!segment) continue
      const asset = segment.assets
      if (asset && asset.status !== 'ready') continue

      let embVector: number[] = []
      if (Array.isArray(row.embedding)) {
        embVector = row.embedding
      } else if (typeof row.embedding === 'string') {
        try {
          embVector = JSON.parse(row.embedding)
        } catch (e) {
          continue
        }
      }

      const similarity = cosineSimilarity(queryEmbedding, embVector)
      
      const contentLower = (segment.content || '').toLowerCase()
      let matchCount = 0
      for (const kw of queryKeywords) {
        if (contentLower.includes(kw)) matchCount++
      }
      const keywordScore = queryKeywords.length > 0 ? (matchCount / queryKeywords.length) : 0
      const importanceScore = typeof segment.importance_score === 'number' ? segment.importance_score : 0.8

      // Hybrid fusion
      const finalScore = (similarity * 0.75) + (keywordScore * 0.15) + (importanceScore * 0.10)

      // Minimum threshold
      if (similarity >= 0.28 || keywordScore > 0.4) {
        rawSegmentMatches.push({
          asset_id: segment.asset_id,
          segment_type: segment.segment_type,
          importance_score: segment.importance_score,
          content: segment.content || '',
          start_time: segment.start_time ?? segment.metadata?.start_time ?? null,
          end_time: segment.end_time ?? segment.metadata?.end_time ?? null,
          similarity,
          keyword_score: keywordScore,
          final_score: finalScore,
          original_name: asset?.original_name || 'unknown',
          file_type: asset?.file_type || 'unknown',
          file_path: asset?.file_path || '',
          file_size: asset?.file_size || 0,
          created_at: asset?.created_at || new Date().toISOString()
        })
      }
    }
  }

  if (rawSegmentMatches.length === 0) {
    return []
  }

  // 3. Group and deduplicate strictly by Asset (Original File), capturing best timestamp and score
  const assetScoreMap = new Map<string, { bestScore: number; startTime: number | null; endTime: number | null; assetData: any; topSnippets: string[] }>()

  for (const match of rawSegmentMatches) {
    const assetId = match.asset_id
    const score = match.final_score ?? match.similarity ?? 0
    const startTime = match.start_time !== undefined ? match.start_time : null
    const endTime = match.end_time !== undefined ? match.end_time : null
    
    if (!assetScoreMap.has(assetId)) {
      assetScoreMap.set(assetId, {
        bestScore: score,
        startTime: startTime,
        endTime: endTime,
        assetData: match,
        topSnippets: match.content ? [match.content] : []
      })
    } else {
      const existing = assetScoreMap.get(assetId)!
      if (match.content && !existing.topSnippets.includes(match.content) && existing.topSnippets.length < 4) {
        existing.topSnippets.push(match.content)
      }
      if (score > existing.bestScore) {
        existing.bestScore = score
        existing.startTime = startTime
        existing.endTime = endTime
        existing.assetData = match
      }
    }
  }

  // 4. Grouped candidates
  let candidateAssets = Array.from(assetScoreMap.entries())
    .map(([assetId, val]) => ({
      asset_id: assetId,
      score: val.bestScore,
      start_time: val.startTime,
      end_time: val.endTime,
      topSnippets: val.topSnippets,
      ...val.assetData
    }))

  if (useReranker) {
    // When reranking is enabled, apply relevance thresholds
    candidateAssets.sort((a, b) => b.score - a.score)
    if (candidateAssets.length > 0) {
      const topScore = candidateAssets[0].score
      const minThreshold = Math.max(0.30, topScore * 0.60)
      candidateAssets = candidateAssets.filter(a => a.score >= minThreshold).slice(0, limit)
    }
  } else {
    // When without reranking, take raw retrieval slice
    candidateAssets = candidateAssets.slice(0, limit)
  }

  // 5. Fetch full asset details and resolve signed media preview URLs
  const enrichedFiles = await Promise.all(
    candidateAssets.map(async (item) => {
      let filePath = item.file_path
      let fileType = item.file_type
      let originalName = item.original_name
      let fileSize = item.file_size
      let createdAt = item.created_at

      if (!filePath || !fileType) {
        const { data: assetRow } = await supabase
          .from('assets')
          .select('*')
          .eq('id', item.asset_id)
          .single()

        if (assetRow) {
          filePath = assetRow.file_path
          fileType = assetRow.file_type
          originalName = assetRow.original_name
          fileSize = assetRow.file_size
          createdAt = assetRow.created_at
        }
      }

      let mediaUrl = ''
      if (filePath) {
        const bucket = fileType === 'image' ? 'images' : fileType === 'video' ? 'videos' : 'documents'
        try {
          const { data } = await supabase.storage.from(bucket).createSignedUrl(filePath, 7200)
          mediaUrl = data?.signedUrl || ''
        } catch (e) {}
      }

      return {
        asset_id: item.asset_id,
        original_name: originalName || 'Untitled File',
        file_type: fileType || 'document',
        segment_type: item.segment_type,
        importance_score: item.importance_score,
        file_path: filePath,
        file_size: fileSize || 0,
        media_url: mediaUrl,
        score: item.score,
        start_time: item.start_time ?? null,
        end_time: item.end_time ?? null,
        topSnippets: item.topSnippets || [],
        answer: undefined as string | undefined,
        created_at: createdAt
      }
    })
  )

  // 6. Stage 2: Advanced XGBoost Reranking vs Random Unranked Baseline
  if (useReranker) {
    return rerankCandidatesWithXGBoost(query, enrichedFiles)
  } else {
    // In without reranking mode: return random order of retrieval data
    const randomized = [...enrichedFiles]
    for (let i = randomized.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [randomized[i], randomized[j]] = [randomized[j], randomized[i]]
    }
    return randomized.map(cand => ({
      ...cand,
      stage1_score: cand.score,
      rerank_score: cand.score,
      reranked: false
    }))
  }
}

export function extractTargetedExcerpt(content: string, query: string): string {
  if (!content) return ''
  let cleaned = content
    .replace(/^Document Summary:\s*/i, '')
    .replace(/^Key Document Insights:\s*/i, '')
    .replace(/^Marks, Scores & Academic\/Performance Data:\s*/i, '')
    .trim()

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (queryWords.length === 0) {
    return cleaned.slice(0, 160) + (cleaned.length > 160 ? '...' : '')
  }

  const sentences = cleaned.split(/(?<=[.!?\n])\s+/)
  let bestSentence = ''
  let maxMatches = 0

  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase()
    let matches = 0
    for (const word of queryWords) {
      if (sLower.includes(word)) matches++
    }
    if (matches > maxMatches) {
      maxMatches = matches
      bestSentence = sentence.trim()
    }
  }

  if (bestSentence && bestSentence.length > 10) {
    return bestSentence.slice(0, 200) + (bestSentence.length > 200 ? '...' : '')
  }

  return cleaned.slice(0, 160) + (cleaned.length > 160 ? '...' : '')
}

/**
 * Execute search and synthesize targeted, direct answers
 */
export async function searchWithSemanticAnswer(query: string, limit = 12, useReranker = true): Promise<{
  results: any[]
  directAnswer: string
  sourceDoc?: string
  useReranker: boolean
}> {
  let results = await search(query, limit, useReranker)
  if (!results || results.length === 0) {
    return { results: [], directAnswer: '', useReranker }
  }

  let directAnswer = ''
  let sourceDoc = ''

  // 1. Fetch full text of segments for candidates
  const resultsWithFullText = await Promise.all(
    results.slice(0, 10).map(async (item) => {
      const { data: segs } = await supabase
        .from('segments')
        .select('content')
        .eq('asset_id', item.asset_id)

      const fullText = (segs || []).map(s => s.content).join('\n')
      return {
        ...item,
        fullText
      }
    })
  )

  // 2. Extract precise answers
  try {
    const answerMap = await extractAnswersForResultsWithGemini({ query, results: resultsWithFullText })

    for (const item of results) {
      const geminiAnswer = answerMap.get(item.original_name)
      if (geminiAnswer && geminiAnswer !== 'NO_MATCH') {
        item.answer = geminiAnswer
        if (!directAnswer) {
          directAnswer = geminiAnswer
          sourceDoc = item.original_name
        }
      } else {
        item.answer = `No relevant answer for "${query}" in this document.`
      }
      delete item.topSnippets
    }
  } catch (e: any) {
    console.warn('Answer extraction error:', e?.message || e)
    for (const item of results) {
      const firstSnip = item.topSnippets?.[0] || ''
      item.answer = extractTargetedExcerpt(firstSnip, query)
      delete item.topSnippets
    }
  }

  if (useReranker) {
    // When with reranker: prioritize matching results and sort in strict descending order of relevance
    const matchingResults = results.filter(item => item.answer && !item.answer.startsWith('No relevant answer'))

    if (matchingResults.length > 0) {
      results = matchingResults
    } else {
      const queryLower = query.toLowerCase().trim()
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2)
      results = results.filter(item => {
        const nameLower = (item.original_name || '').toLowerCase()
        const ansLower = (item.answer || '').toLowerCase()
        return queryWords.some(w => nameLower.includes(w) || ansLower.includes(w))
      })
    }

    // Sort strictly by relevance score
    results.sort((a, b) => (b.score || 0) - (a.score || 0))
  } else {
    // When without reranker: maintain randomized / baseline retrieval order
    // Do not sort by relevance - keep random order of retrieval data
  }

  return {
    results,
    directAnswer,
    sourceDoc,
    useReranker
  }
}