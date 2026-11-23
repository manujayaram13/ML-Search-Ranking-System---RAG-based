import { supabase } from './supabase'
import sharp from 'sharp'
import Groq from 'groq-sdk'
import { analyzeImageWithGemini } from './gemini'

export function cleanVisionResponse(raw: string): string {
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
    if (/^\d+\.\s*\*\*Identify/i.test(trimmed)) return false
    if (/^(\*|\-)\s*\*\*[A-Za-z\s]+:\*\*/.test(trimmed)) return false
    if (/^\*\*[A-Za-z\s]+:\*\*/.test(trimmed) && trimmed.length < 50) return false
    if (/^(Plan|Drafting|Thinking|Key Points|Constraints):/i.test(trimmed)) return false
    if (/^(Analyze the image|Describe the|Step \d)/i.test(trimmed)) return false
    return true
  })

  s = cleanLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  s = s.replace(/^(Caption|Description):\s*/i, '').trim()
  s = s.replace(/<\/?[^>]+(>|$)/g, '').trim()
  return s
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

async function updateStatus(assetId: string, message: string) {
  await supabase
    .from('assets')
    .update({ 
      status: 'processing',
      error_message: message
    })
    .eq('id', assetId)
}

export async function processImage(assetId: string) {
  console.log('=== Starting processImage ===', assetId)

  try {
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single()

    if (assetError || !asset) throw new Error('Asset not found')

    // Progress 1
    await updateStatus(assetId, 'Downloading image...')

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('images')
      .download(asset.file_path)

    if (downloadError || !fileData) throw downloadError

    const buffer = Buffer.from(await fileData.arrayBuffer())

    // Progress 2
    await updateStatus(assetId, 'Analyzing visual scene, emotions, weather & details...')

    let caption = ''
    let description = ''
    let visionOcr = ''

    const resizedBuffer = await sharp(buffer)
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    const base64Image = resizedBuffer.toString('base64')

    // 1. Primary: Google Gemini Vision Analysis
    try {
      console.log('Calling Google Gemini Vision for rich captioning & scene analysis...')
      const geminiResult = await analyzeImageWithGemini(base64Image, 'image/jpeg')
      caption = geminiResult.caption
      description = geminiResult.description
      if (geminiResult.ocrText && geminiResult.ocrText.trim().length > 3) {
        visionOcr = geminiResult.ocrText.trim()
      }
    } catch (geminiErr: any) {
      console.warn('Gemini vision warning, attempting fallback:', geminiErr?.message || geminiErr)
    }

    // 2. Fallback to Groq Vision if Gemini is unavailable
    if ((!caption || !description) && process.env.GROQ_API_KEY) {
      const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY })

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`Calling Groq Vision Fallback (attempt ${attempt})...`)
          const visionRes = await groqClient.chat.completions.create({
            model: 'qwen/qwen3.6-27b',
            messages: [
              {
                role: 'system',
                content: `You are an expert cinematic visual analyst. Analyze the image comprehensively.`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Provide:
1. Caption: A 1-2 sentence cinematic caption capturing the scene, subjects, weather, actions, and mood.
2. Description: A rich multi-sentence visual description capturing all visual elements, clothing, colors, objects, environment, and atmosphere.`
                  },
                  {
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                  }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 1200
          })

          const rawContent = visionRes.choices[0]?.message?.content || ''
          const cleaned = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

          const capMatch = cleaned.match(/(?:Caption|1\. Caption|\*\*Cinematic Caption\*\*|\*\*Caption\*\*):\s*([\s\S]*?)(?=(?:Description|2\. Description|\*\*Detailed Description\*\*|\*\*Description\*\*)|$)/i)
          const descMatch = cleaned.match(/(?:Description|2\. Description|\*\*Detailed Description\*\*|\*\*Description\*\*):\s*([\s\S]*)/i)

          if (capMatch && capMatch[1].trim().length > 5) {
            caption = cleanVisionResponse(capMatch[1].trim())
          }
          if (descMatch && descMatch[1].trim().length > 10) {
            description = cleanVisionResponse(descMatch[1].trim())
          }

          if (caption && description) break
        } catch (err: any) {
          console.warn(`Groq fallback attempt ${attempt} warning:`, err.message)
        }
      }
    }

    if (!caption || !description) {
      throw new Error('Image visual analysis failed. Please verify your GEMINI_API_KEY.')
    }

    console.log('Gemini Caption:', caption)
    console.log('Gemini Description Length:', description.length)

    // We now rely entirely on Gemini for OCR (visionOcr)

    // Progress 4
    await updateStatus(assetId, 'Creating multimodal vector embeddings...')

    // Remove any previous segments for this asset
    const { data: oldSegs } = await supabase
      .from('segments')
      .select('id')
      .eq('asset_id', assetId)

    if (oldSegs && oldSegs.length > 0) {
      const oldIds = oldSegs.map(s => s.id)
      await supabase.from('embeddings').delete().in('segment_id', oldIds)
      await supabase.from('segments').delete().eq('asset_id', assetId)
    }

    const items = [
      { type: 'caption', content: caption, score: 0.95 },
      { type: 'description', content: description, score: 0.90 }
    ]

    const combinedOcr = visionOcr

    if (combinedOcr.length > 3) {
      items.push({ type: 'ocr', content: combinedOcr, score: 0.85 })
    }

    for (const item of items) {
      const { data: segment, error: segError } = await supabase
        .from('segments')
        .insert({
          asset_id: assetId,
          segment_type: item.type,
          content: item.content,
          importance_score: item.score,
          metadata: { modality: 'image' }
        })
        .select()
        .single()

      if (segError) throw segError

      const embedding = await getEmbedding(item.content)

      const { error: embError } = await supabase.from('embeddings').insert({
        segment_id: segment.id,
        embedding_type: 'text',
        embedding
      })

      if (embError) throw embError
    }

    // Final success
    await supabase
      .from('assets')
      .update({ 
        status: 'ready',
        error_message: null
      })
      .eq('id', assetId)

    console.log('=== Image processed successfully ===')
  } catch (err: any) {
    console.error('=== IMAGE PROCESSING FAILED ===', err)
    const errorMessage = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err))

    await supabase
      .from('assets')
      .update({
        status: 'failed',
        error_message: errorMessage
      })
      .eq('id', assetId)
  }
}
