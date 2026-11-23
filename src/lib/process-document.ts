import { supabase } from './supabase'
// Removing pdf-parse in favor of LlamaParse
import mammoth from 'mammoth'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { analyzeDocumentWithGemini, extractPdfTextWithGemini } from './gemini'

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
      task: 'retrieval.passage'
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Jina embedding failed: ${err}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

async function parseWithLlamaParse(buffer: Buffer, filename: string): Promise<string> {
  const apiKey = process.env.LLAMACLOUD_API_KEY || ''
  if (!apiKey) throw new Error('LLAMACLOUD_API_KEY is missing in environment variables. Please add it to use LlamaParse.')

  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(buffer)]), filename)

  const uploadRes = await fetch('https://api.cloud.llamaindex.ai/api/parsing/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData as any
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    throw new Error(`LlamaParse upload failed: ${err}`)
  }

  const uploadData = await uploadRes.json()
  const jobId = uploadData.id

  let status = 'PENDING'
  while (status === 'PENDING') {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const statusRes = await fetch(`https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })

    if (!statusRes.ok) throw new Error('Failed to check LlamaParse job status')

    const statusData = await statusRes.json()
    status = statusData.status

    if (status === 'ERROR') throw new Error('LlamaParse job failed')
  }

  const resultRes = await fetch(`https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}/result/markdown`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })

  if (!resultRes.ok) throw new Error('Failed to get LlamaParse result')

  const resultData = await resultRes.json()
  return resultData.markdown || ''
}

async function updateStatus(assetId: string, message: string) {
  await supabase
    .from('assets')
    .update({
      status: 'processing',
      error_message: message
    })
    .eq('id', assetId)
}

export async function processDocument(assetId: string) {
  console.log('=== Starting processDocument ===', assetId)

  try {
    // 1. Get asset info
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single()

    if (assetError || !asset) throw new Error('Asset not found')

    // 2. Download file from Storage
    await updateStatus(assetId, 'Downloading document...')
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(asset.file_type === 'document' ? 'documents' : 'documents')
      .download(asset.file_path)

    if (downloadError || !fileData) throw downloadError

    const buffer = Buffer.from(await fileData.arrayBuffer())

    // 3. Extract text
    await updateStatus(assetId, 'Extracting text from document...')
    let rawText = ''

    if (asset.mime_type === 'application/pdf' || asset.original_name.toLowerCase().endsWith('.pdf')) {
      try {
        rawText = await parseWithLlamaParse(buffer, asset.original_name)
      } catch (llamaErr: any) {
        console.warn('LlamaParse failed or missing key, falling back to Gemini Multimodal PDF OCR:', llamaErr?.message || llamaErr)
        rawText = await extractPdfTextWithGemini(buffer.toString('base64'))
      }
    } else if (
      asset.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      asset.original_name.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer })
      rawText = result.value
    } else {
      // .txt or other text
      rawText = buffer.toString('utf-8')
    }

    if (!rawText || rawText.trim().length < 10) {
      // Attempt Gemini PDF OCR fallback if rawText is empty
      if (asset.mime_type === 'application/pdf' || asset.original_name.toLowerCase().endsWith('.pdf')) {
        console.log('Attempting Gemini Multimodal PDF OCR fallback for empty text...')
        rawText = await extractPdfTextWithGemini(buffer.toString('base64'))
      }
    }

    if (!rawText || rawText.trim().length < 5) {
      throw new Error('Could not extract meaningful text or OCR content from document')
    }

    // 4. Clean text
    const cleanedText = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+/g, ' ')
      .trim()

    // 5. Deep Gemini Semantic Document Analysis (Extracts summary, key topics, and explicit marks/scores/tables)
    await updateStatus(assetId, 'Analyzing document semantics & extracting marks with Gemini...')

    let docAnalysis: any = null
    try {
      console.log('Calling Gemini for semantic document analysis & marks extraction...')
      docAnalysis = await analyzeDocumentWithGemini({
        text: cleanedText,
        originalName: asset.original_name,
        mimeType: asset.mime_type
      })
      console.log('Gemini Document Summary:', docAnalysis.summary?.slice(0, 100))
      if (docAnalysis.marksAndScores) {
        console.log('Gemini Extracted Marks/Scores:', docAnalysis.marksAndScores)
      }
    } catch (geminiErr: any) {
      console.warn('Gemini document analysis warning:', geminiErr?.message || geminiErr)
    }

    // Remove any previous segments for this asset if re-processing
    const { data: oldSegs } = await supabase
      .from('segments')
      .select('id')
      .eq('asset_id', assetId)

    if (oldSegs && oldSegs.length > 0) {
      const oldIds = oldSegs.map(s => s.id)
      await supabase.from('embeddings').delete().in('segment_id', oldIds)
      await supabase.from('segments').delete().eq('asset_id', assetId)
    }

    await updateStatus(assetId, 'Generating vector embeddings & chunking...')

    // 6. Insert high-priority Gemini semantic segments
    if (docAnalysis) {
      // Document Summary Segment
      if (docAnalysis.summary && docAnalysis.summary.length > 10) {
        const { data: seg, error: segErr } = await supabase
          .from('segments')
          .insert({
            asset_id: assetId,
            segment_type: 'document_summary',
            content: `Document Summary: ${docAnalysis.summary}`,
            importance_score: 0.98,
            metadata: { source: 'document', modality: 'text', type: 'gemini_summary' }
          })
          .select()
          .single()

        if (!segErr && seg) {
          const emb = await getEmbedding(seg.content)
          await supabase.from('embeddings').insert({
            segment_id: seg.id,
            embedding_type: 'text',
            embedding: emb
          })
        }
      }

      // Explicit Marks & Scores Segment (if detected in the PDF/document)
      if (docAnalysis.marksAndScores && docAnalysis.marksAndScores.length > 5) {
        const { data: seg, error: segErr } = await supabase
          .from('segments')
          .insert({
            asset_id: assetId,
            segment_type: 'marks_and_scores',
            content: `Marks, Scores & Academic/Performance Data:\n${docAnalysis.marksAndScores}`,
            importance_score: 0.99,
            metadata: { source: 'document', modality: 'text', type: 'gemini_marks' }
          })
          .select()
          .single()

        if (!segErr && seg) {
          const emb = await getEmbedding(seg.content)
          await supabase.from('embeddings').insert({
            segment_id: seg.id,
            embedding_type: 'text',
            embedding: emb
          })
        }
      }

      // Key Points / Insights Segment
      if (docAnalysis.keyPoints && docAnalysis.keyPoints.length > 0) {
        const keyPointsText = `Key Document Insights:\n- ${docAnalysis.keyPoints.join('\n- ')}`
        const { data: seg, error: segErr } = await supabase
          .from('segments')
          .insert({
            asset_id: assetId,
            segment_type: 'key_points',
            content: keyPointsText,
            importance_score: 0.90,
            metadata: { source: 'document', modality: 'text', type: 'gemini_insights' }
          })
          .select()
          .single()

        if (!segErr && seg) {
          const emb = await getEmbedding(seg.content)
          await supabase.from('embeddings').insert({
            segment_id: seg.id,
            embedding_type: 'text',
            embedding: emb
          })
        }
      }
    }

    // 7. Structure-aware + Semantic style chunking for comprehensive raw text coverage
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800,
      chunkOverlap: 150,
      separators: ['\n\n', '\n', '. ', ' ', '']
    })

    const chunks = await splitter.createDocuments([cleanedText])

    // Store raw text chunks + embeddings
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i].pageContent

      const { data: segment, error: segError } = await supabase
        .from('segments')
        .insert({
          asset_id: assetId,
          segment_type: 'chunk',
          content: chunkText,
          chunk_index: i,
          importance_score: i === 0 ? 0.9 : 0.65,
          metadata: { source: 'document', modality: 'text' }
        })
        .select()
        .single()

      if (segError) throw segError

      const embedding = await getEmbedding(chunkText)

      const { error: embError } = await supabase.from('embeddings').insert({
        segment_id: segment.id,
        embedding_type: 'text',
        embedding
      })

      if (embError) throw embError
    }

    // 8. Mark asset as ready
    await supabase
      .from('assets')
      .update({ status: 'ready', error_message: null, updated_at: new Date().toISOString() })
      .eq('id', assetId)

    console.log(`Document ${assetId} processed successfully with Gemini semantic insights`)
  } catch (err: any) {
    console.error('Document processing failed:', err)
    const errorMessage = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err))

    await supabase
      .from('assets')
      .update({
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date().toISOString()
      })
      .eq('id', assetId)
  }
}
