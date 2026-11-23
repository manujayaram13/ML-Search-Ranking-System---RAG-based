import { supabase } from './supabase'
import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import Groq from 'groq-sdk'
import sharp from 'sharp'

try {
  const ffmpegPkg = '@ffmpeg-installer/' + 'ffmpeg'
  const ffprobePkg = '@ffprobe-installer/' + 'ffprobe'
  const ffmpegExe = eval("require")(ffmpegPkg).path
  const ffprobeExe = eval("require")(ffprobePkg).path
  ffmpeg.setFfmpegPath(ffmpegExe)
  ffmpeg.setFfprobePath(ffprobeExe)
} catch (e) {
  console.warn('FFmpeg binary path setup warning:', e)
}

import { analyzeKeyframeWithGemini } from './gemini'

function getGroqClient(): Groq | null {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  return apiKey ? new Groq({ apiKey }) : null
}

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

async function analyzeKeyframeWithRetry(base64Image: string, maxRetries = 2): Promise<string> {
  // 1. Primary: Gemini Vision Analysis
  try {
    const geminiDesc = await analyzeKeyframeWithGemini(base64Image, 'image/jpeg')
    if (geminiDesc && geminiDesc.trim().length > 5) {
      return geminiDesc.trim()
    }
  } catch (geminiErr: any) {
    console.warn('Gemini keyframe vision attempt error, using fallback:', geminiErr?.message || geminiErr)
  }

  // 2. Fallback: Groq Vision
  const groq = getGroqClient()
  if (!groq) {
    return ''
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const visionRes = await groq.chat.completions.create({
        model: 'qwen/qwen3.6-27b',
        messages: [
          {
            role: 'system',
            content: 'You are an expert video visual analyst. Describe the video frame with a clear 1-2 sentence caption and scene description covering subjects, actions, environment, and objects.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe what is happening in this video frame concisely.'
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Image}` }
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 600
      })

      const rawText = visionRes.choices[0]?.message?.content || ''
      const cleanText = cleanVisionResponse(rawText)
      if (cleanText && cleanText.length > 10) {
        return cleanText
      }
    } catch (err: any) {
      console.warn(`Groq keyframe attempt ${attempt} warning: ${err.message}`)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1500 * attempt))
      }
    }
  }
  return ''
}

async function getEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length < 3) return []

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
    console.error('Embedding failed:', await response.text())
    return []
  }

  const data = await response.json()
  return data.data?.[0]?.embedding || []
}

async function updateStatus(assetId: string, message: string) {
  await supabase
    .from('assets')
    .update({ status: 'processing', error_message: message })
    .eq('id', assetId)
}

export async function processVideo(assetId: string) {
  console.log('=== Starting Fast Optimized processVideo ===', assetId)
  const tempDir = path.join(os.tmpdir(), `video-${uuidv4()}`)
  
  try {
    fs.mkdirSync(tempDir, { recursive: true })

    // 1. Get asset
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single()

    if (assetError || !asset) {
      throw new Error('Asset not found')
    }

    await updateStatus(assetId, 'Downloading video...')

    // 2. Download
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('videos')
      .download(asset.file_path)

    if (downloadError || !fileData) {
      throw new Error('Failed to download video: ' + (downloadError?.message || 'No data'))
    }

    const videoPath = path.join(tempDir, 'input.mp4')
    const buffer = Buffer.from(await fileData.arrayBuffer())

    if (buffer.length < 1000) {
      throw new Error('Video file is too small or empty')
    }

    fs.writeFileSync(videoPath, buffer)

    // 3. Get video info
    const videoInfo: any = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err)
        else resolve(metadata)
      })
    })

    const duration = videoInfo?.format?.duration || 0
    console.log('Video duration:', duration, 'seconds')

    if (duration < 0.5) {
      throw new Error('Video is too short')
    }

    // 4. Extract audio & transcribe in parallel with keyframe extraction
    await updateStatus(assetId, 'Extracting audio & keyframes in parallel...')
    const audioPath = path.join(tempDir, 'audio.mp3')

    // Clean old segments
    const { data: oldSegs } = await supabase.from('segments').select('id').eq('asset_id', assetId)
    if (oldSegs && oldSegs.length > 0) {
      const oldIds = oldSegs.map(s => s.id)
      await supabase.from('embeddings').delete().in('segment_id', oldIds)
      await supabase.from('segments').delete().eq('asset_id', assetId)
    }

    // Fast, balanced keyframe count (6 to 10 frames)
    const frameCount = duration <= 15 ? 5 : duration <= 45 ? 8 : duration <= 90 ? 10 : 12
    const keyframeDir = path.join(tempDir, 'frames')
    fs.mkdirSync(keyframeDir, { recursive: true })

    // Run Audio extraction and Keyframe extraction simultaneously
    await Promise.all([
      // Audio extract
      new Promise((resolve) => {
        ffmpeg(videoPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate('128k')
          .save(audioPath)
          .on('end', resolve)
          .on('error', (err) => {
            console.warn('Audio extraction warning:', err.message)
            resolve(null)
          })
      }),
      // Keyframe extract
      new Promise((resolve) => {
        ffmpeg(videoPath)
          .on('end', resolve)
          .on('error', (err) => {
            console.warn('Keyframe extraction warning:', err.message)
            resolve(null)
          })
          .screenshots({
            count: frameCount,
            folder: keyframeDir,
            filename: 'frame-%i.jpg',
            size: '512x?'
          })
      })
    ])

    // 5. Transcription (if audio found)
    const groqForAudio = getGroqClient()
    if (groqForAudio && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
      try {
        const transcription = await groqForAudio.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: 'whisper-large-v3',
          response_format: 'verbose_json',
          timestamp_granularities: ['segment']
        })

        const transcriptSegs = (transcription as any).segments || []
        for (let i = 0; i < transcriptSegs.length; i++) {
          const seg = transcriptSegs[i]
          const text = seg.text?.trim()
          if (!text || text.length < 3) continue

          const startTime = seg.start || 0
          const endTime = seg.end || Math.min(duration, startTime + 5)

          const { data: segment } = await supabase
            .from('segments')
            .insert({
              asset_id: assetId,
              segment_type: 'transcript_chunk',
              content: text,
              start_time: startTime,
              end_time: endTime,
              chunk_index: i,
              importance_score: 0.85,
              metadata: {
                modality: 'video_transcript',
                start_time: startTime,
                end_time: endTime
              }
            })
            .select()
            .single()

          if (segment) {
            const embedding = await getEmbedding(text)
            if (embedding.length > 0) {
              await supabase.from('embeddings').insert({
                segment_id: segment.id,
                embedding_type: 'text',
                embedding
              })
            }
          }
        }
      } catch (transcribeErr: any) {
        console.warn('Transcription warning:', transcribeErr.message)
      }
    }

    // 6. Fast Parallel Keyframe Analysis
    const frameFiles = fs.existsSync(keyframeDir)
      ? fs.readdirSync(keyframeDir).filter(f => f.endsWith('.jpg'))
      : []

    console.log(`Processing ${frameFiles.length} keyframes in parallel...`)
    await updateStatus(assetId, `Analyzing ${frameFiles.length} keyframes with Gemini Vision...`)

    const processKeyframe = async (i: number, frameFile: string) => {
      try {
        const framePath = path.join(keyframeDir, frameFile)
        const frameBuffer = fs.readFileSync(framePath)

        const keyframeName = `keyframes/${assetId}-${i}.jpg`
        try {
          await supabase.storage
            .from('keyframes')
            .upload(keyframeName, frameBuffer, {
              contentType: 'image/jpeg',
              upsert: true
            })
        } catch (uploadErr) {
          console.warn('Keyframe storage upload warning:', uploadErr)
        }

        const frameTimestamp = Math.min(duration, Math.round((i / Math.max(1, frameFiles.length - 1)) * duration * 10) / 10)
        const frameEnd = Math.min(duration, frameTimestamp + Math.max(2, duration / frameFiles.length))

        const resized = await sharp(frameBuffer)
          .resize({ width: 512, withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toBuffer()

        const base64 = resized.toString('base64')
        const visionDescription = await analyzeKeyframeWithRetry(base64)
        const finalContent = visionDescription || `Keyframe at ${frameTimestamp.toFixed(1)}s`

        const { data: segment } = await supabase
          .from('segments')
          .insert({
            asset_id: assetId,
            segment_type: 'keyframe',
            content: finalContent,
            start_time: frameTimestamp,
            end_time: frameEnd,
            chunk_index: i,
            importance_score: 0.85,
            metadata: {
              modality: 'video_keyframe',
              media_path: keyframeName,
              start_time: frameTimestamp,
              end_time: frameEnd
            }
          })
          .select()
          .single()

        if (segment) {
          const embedding = await getEmbedding(finalContent)
          if (embedding.length > 0) {
            await supabase.from('embeddings').insert({
              segment_id: segment.id,
              embedding_type: 'text',
              embedding
            })
          }
        }
      } catch (e: any) {
        console.warn(`Keyframe ${i} failed:`, e.message)
      }
    }

    // Run in parallel batches of 2 with brief stagger to optimize speed and stay within rate limits
    const batchSize = 2
    for (let b = 0; b < frameFiles.length; b += batchSize) {
      const batch = frameFiles.slice(b, b + batchSize)
      await Promise.all(batch.map((f, bIdx) => processKeyframe(b + bIdx, f)))
      if (b + batchSize < frameFiles.length) {
        await new Promise(r => setTimeout(r, 350))
      }
    }

    // 7. Final Success
    await supabase
      .from('assets')
      .update({
        status: 'ready',
        error_message: null
      })
      .eq('id', assetId)

    console.log(`=== Video processed successfully in fast mode ===`, assetId)
  } catch (err: any) {
    console.error('=== VIDEO PROCESSING FAILED ===', err)
    await supabase
      .from('assets')
      .update({
        status: 'failed',
        error_message: err?.message || 'Video processing failed'
      })
      .eq('id', assetId)
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (e) {}
  }
}
