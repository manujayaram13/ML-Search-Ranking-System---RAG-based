import { NextRequest, NextResponse } from 'next/server'
import { search } from '@/lib/search'
import sharp from 'sharp'
import Groq from 'groq-sdk'
import { generateGeminiContent, cleanGeminiResponse } from '@/lib/gemini'

function getGroqClient(): Groq | null {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  return apiKey ? new Groq({ apiKey }) : null
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File | null
    const useRerankerRaw = formData.get('useReranker')
    const useReranker = useRerankerRaw === null ? true : useRerankerRaw === 'true'
    if (!imageFile) {
      return NextResponse.json({ error: 'Image file required' }, { status: 400 })
    }

    const buffer = Buffer.from(await imageFile.arrayBuffer())

    // Resize image for fast multimodal vision processing
    const resizedBuffer = await sharp(buffer)
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    const base64Image = resizedBuffer.toString('base64')

    let queryText = ''

    // 1. Primary: Gemini Vision Analysis for Visual Query
    try {
      const prompt = `Analyze this search query image. Describe the main subjects, action, colors, objects, visible text, and scene concisely in 1-2 sentences for semantic search matching.`
      const systemInstruction = `You are a visual search query analyzer. You extract the essential search keywords and scene description from images.`
      const geminiRes = await generateGeminiContent({
        prompt,
        systemInstruction,
        imageBase64: base64Image,
        mimeType: 'image/jpeg',
        temperature: 0.1,
        maxOutputTokens: 200
      })
      queryText = cleanGeminiResponse(geminiRes)
    } catch (geminiErr: any) {
      console.warn('Gemini image search analysis warning, using fallback:', geminiErr?.message || geminiErr)
    }

    // 2. Fallback to Groq Vision
    if (!queryText || queryText.length < 5) {
      const groq = getGroqClient()
      if (groq) {
        const visionResponse = await groq.chat.completions.create({
          model: 'qwen/qwen3.6-27b',
          messages: [
            {
              role: 'system',
              content: 'You are a visual search query analyzer. Describe the visual concepts, subjects, actions, and objects in this image concisely as a search query.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Describe the main subjects and scene in this image in 1-2 descriptive sentences for visual search matching.'
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 150
        })

        let groqText = visionResponse.choices[0]?.message?.content || ''
        groqText = groqText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        groqText = groqText.replace(/<\/?[^>]+(>|$)/g, '').trim()
        queryText = groqText
      }
    }

    if (!queryText) {
      queryText = 'image visual search'
    }

    console.log('Image Search Generated Query:', queryText)

    const results = await search(queryText, 12, useReranker)
    return NextResponse.json({ queryText, results, useReranker })
  } catch (err: any) {
    console.error('Image Search Error:', err)
    return NextResponse.json({ error: err?.message || 'Image search failed', results: [], useReranker: true }, { status: 500 })
  }
}
