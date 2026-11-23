import Groq from 'groq-sdk'

export interface GeminiVisionResult {
  caption: string
  description: string
  ocrText?: string
}

export interface GeminiDocAnalysisResult {
  summary: string
  keyPoints: string[]
  marksAndScores?: string
  semanticInsights: string
}

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash'
]

function getGeminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    ''
  ).trim()
}

/**
 * Universal caller for Google Gemini REST API
 */
export async function generateGeminiContent({
  prompt,
  systemInstruction,
  imageBase64,
  mimeType = 'image/jpeg',
  pdfBase64,
  temperature = 0.1,
  maxOutputTokens = 1500
}: {
  prompt: string
  systemInstruction?: string
  imageBase64?: string
  mimeType?: string
  pdfBase64?: string
  temperature?: number
  maxOutputTokens?: number
}): Promise<string> {
  const apiKey = getGeminiApiKey()

  // For text-only prompts, try Groq (qwen/qwen3.8-27b) first for speed and rate-limit immunity
  const groqKey = process.env.GROQ_API_KEY
  if (!imageBase64 && !pdfBase64 && groqKey) {
    try {
      const groqClient = new Groq({ apiKey: groqKey })
      const groqRes = await groqClient.chat.completions.create({
        model: 'qwen/qwen3.8-27b',
        messages: [
          ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
          { role: 'user' as const, content: prompt }
        ],
        temperature
      })
      const text = groqRes.choices[0]?.message?.content
      if (text && text.trim().length > 0) {
        return text.trim()
      }
    } catch (groqErr: any) {
      console.warn('Groq text fallback warning:', groqErr?.message || groqErr)
    }
  }

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local')
  }

  const parts: any[] = [{ text: prompt }]

  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBase64
      }
    })
  }

  if (pdfBase64) {
    parts.push({
      inline_data: {
        mime_type: 'application/pdf',
        data: pdfBase64
      }
    })
  }

  const requestBody: any = {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens
    }
  }

  if (systemInstruction) {
    requestBody.system_instruction = {
      parts: [{ text: systemInstruction }]
    }
  }

  let lastError: any = null

  // Try candidate models in order for highest quality and resilience
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!res.ok) {
        const errText = await res.text()
        console.warn(`Gemini model ${model} returned error ${res.status}:`, errText)
        lastError = new Error(`Gemini (${model}) error: ${errText}`)
        // If 404 model not found or 429 rate limit, try next model in list
        continue
      }

      const json = await res.json()
      const candidateText = json?.candidates?.[0]?.content?.parts?.[0]?.text
      if (candidateText && typeof candidateText === 'string' && candidateText.trim().length > 0) {
        return candidateText.trim()
      }
    } catch (err: any) {
      console.warn(`Gemini invocation failed for ${model}:`, err?.message || err)
      lastError = err
    }
  }

  // Final fallback to Groq if Gemini failed on multimodal or text
  if (groqKey) {
    try {
      const groqClient = new Groq({ apiKey: groqKey })
      const groqRes = await groqClient.chat.completions.create({
        model: 'qwen/qwen3.8-27b',
        messages: [
          ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
          { role: 'user' as const, content: prompt }
        ],
        temperature
      })
      const text = groqRes.choices[0]?.message?.content
      if (text && text.trim().length > 0) {
        return text.trim()
      }
    } catch (groqErr: any) {}
  }

  throw lastError || new Error('All LLM models (Gemini & Groq) failed to generate a response')
}

/**
 * Clean model output string of markdown think tags or prefixes
 */
export function cleanGeminiResponse(raw: string): string {
  if (!raw) return ''
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim()
  return s
}

/**
 * Exhaustively extract text, tables, marks, and content from a PDF document using Gemini Multimodal OCR
 */
export async function extractPdfTextWithGemini(pdfBase64: string): Promise<string> {
  const prompt = `Perform complete, exhaustive OCR text extraction on this entire PDF document.
Transcribe all readable text, tables, student names, subject titles, marks, test scores, grades, headings, dates, numbers, and notes verbatim from every page.
Do not skip any text or numbers. Return the complete extracted document text.`

  const systemInstruction = `You are a precision document OCR engine. Your sole task is to transcribe all text, numbers, tables, and marks from the document exactly as they appear.`

  try {
    const raw = await generateGeminiContent({
      prompt,
      systemInstruction,
      pdfBase64,
      temperature: 0.1,
      maxOutputTokens: 4000
    })
    return cleanGeminiResponse(raw)
  } catch (err: any) {
    console.warn('Gemini PDF OCR extraction error:', err?.message || err)
    return ''
  }
}

/**
 * Analyze an Image using Gemini: Returns vivid Caption, Detailed Description, and OCR text
 */
export async function analyzeImageWithGemini(
  base64Image: string,
  mimeType = 'image/jpeg'
): Promise<GeminiVisionResult> {
  const prompt = `Analyze this image in depth and provide a JSON response formatted EXACTLY like this:
{
  "caption": "A 1-2 sentence vivid cinematic caption capturing the key subjects, emotions, actions, environment, and mood.",
  "description": "A comprehensive multi-sentence description detailing all visual elements, people, clothing, colors, objects, backdrop, weather, lighting, text/numbers, and atmosphere.",
  "ocrText": "Exhaustive verbatim OCR transcription of ALL visible text, labels, numbers, student names, marks, grades, signage, headings, or captions present in the image (or empty string if none)"
}
Return ONLY the valid raw JSON object, without markdown formatting or code fences.`

  const systemInstruction = `You are a world-class multimodal visual analyst. You provide accurate, rich, cinematic visual breakdowns capturing exact subjects, colors, emotional nuances, environment, visible text, and semantic details.`

  const raw = await generateGeminiContent({
    prompt,
    systemInstruction,
    imageBase64: base64Image,
    mimeType,
    temperature: 0.1,
    maxOutputTokens: 1200
  })

  const cleaned = cleanGeminiResponse(raw)

  try {
    const parsed = JSON.parse(cleaned)
    return {
      caption: parsed.caption || 'Image analysis',
      description: parsed.description || parsed.caption || '',
      ocrText: parsed.ocrText || ''
    }
  } catch (parseError) {
    // If JSON parsing fails, extract fields via regex or fallback
    const capMatch = cleaned.match(/(?:caption|1\. Caption):\s*"?([^"\n\r]+)/i)
    const descMatch = cleaned.match(/(?:description|2\. Description):\s*"?([\s\S]+)/i)

    const caption = capMatch ? capMatch[1].trim() : cleaned.slice(0, 150)
    const description = descMatch ? descMatch[1].trim() : cleaned
    return {
      caption,
      description,
      ocrText: ''
    }
  }
}

/**
 * Analyze Video Keyframe using Gemini
 */
export async function analyzeKeyframeWithGemini(
  base64Image: string,
  mimeType = 'image/jpeg'
): Promise<string> {
  const prompt = `Analyze this video keyframe concisely. Provide a 1-2 sentence descriptive caption capturing the action, subjects, setting, and objects in the frame.`
  const systemInstruction = `You are an expert video visual analyst. Describe the exact scene, people, actions, objects, and environment clearly and concisely.`

  const raw = await generateGeminiContent({
    prompt,
    systemInstruction,
    imageBase64: base64Image,
    mimeType,
    temperature: 0.1,
    maxOutputTokens: 300
  })

  return cleanGeminiResponse(raw)
}

/**
 * Deep Document Semantic Analysis using Gemini:
 * Extracts summary, key facts, and specifically detects & structures marks, grades, scores, tables, or test questions.
 */
export async function analyzeDocumentWithGemini({
  text,
  originalName,
  mimeType
}: {
  text: string
  originalName: string
  mimeType: string
}): Promise<GeminiDocAnalysisResult> {
  const truncatedText = text.slice(0, 15000)

  const prompt = `Analyze the following document content (Filename: "${originalName}") and provide a structured JSON response:

Document Text:
"""
${truncatedText}
"""

Please extract and return a JSON object formatted EXACTLY as:
{
  "summary": "A concise 2-3 sentence overview of what this document is about, its key purpose, and main findings.",
  "keyPoints": [
    "Key point or topic 1",
    "Key point or topic 2",
    "Key point or topic 3"
  ],
  "marksAndScores": "If the document contains student marks, test scores, grades, marks distribution, question marks, academic records, performance metrics, or numerical tables, list all of them clearly here with subject/student/item and corresponding marks/scores. If no marks or scores exist, write 'None'.",
  "semanticInsights": "Key semantic search keywords, topics, entities, names, formulas, and concepts present in this document."
}

Return ONLY valid JSON without markdown wrapping or commentary.`

  const systemInstruction = `You are an expert document understanding and semantic extraction AI. You accurately understand reports, academic marksheets, test papers, resumes, articles, and technical documents, extracting precise factual information, grades, marks, and summaries.`

  const raw = await generateGeminiContent({
    prompt,
    systemInstruction,
    temperature: 0.1,
    maxOutputTokens: 1500
  })

  const cleaned = cleanGeminiResponse(raw)

  try {
    const parsed = JSON.parse(cleaned)
    return {
      summary: parsed.summary || 'Document overview',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      marksAndScores: parsed.marksAndScores && parsed.marksAndScores !== 'None' ? parsed.marksAndScores : '',
      semanticInsights: parsed.semanticInsights || ''
    }
  } catch (e) {
    return {
      summary: cleaned.slice(0, 300),
      keyPoints: [],
      marksAndScores: '',
      semanticInsights: cleaned
    }
  }
}

/**
 * Semantic Question Answering over retrieved search results using Gemini:
 * Provides exact, direct answers for candidate qualifications, marks, scores, skills, dates, and factual questions.
 */
export async function answerSemanticQueryWithGemini({
  query,
  contextSnippets
}: {
  query: string
  contextSnippets: {
    fileName: string
    fileType: string
    content: string
    score?: number
  }[]
}): Promise<{ answer: string; sourceDoc?: string }> {
  if (!contextSnippets || contextSnippets.length === 0) {
    return { answer: '' }
  }

  const contextText = contextSnippets
    .slice(0, 10)
    .map((s, idx) => `[File ${idx + 1}: ${s.fileName} (${s.fileType})]\n${s.content}`)
    .join('\n\n---\n\n')

  const prompt = `Question: "${query}"

Document Content:
"""
${contextText}
"""

Instructions:
1. Provide ONLY the exact, concise factual answer to the question based strictly on the document content above.
2. Direct, concise answers or phrases are preferred (e.g., "87% from GHS Thavarekere (2021)" or "B.E. in Artificial Intelligence & Machine Learning from Cambridge Institute of Technology (CGPA: 8.4)").
3. Do NOT include "Source:", "According to...", "Based on...", or conversational commentary.
4. If the answer cannot be found in the document, return empty string "".`

  const systemInstruction = `You extract direct, exact factual answers from document text. Return only the clean factual answer without introductory filler or source citations.`

  try {
    const raw = await generateGeminiContent({
      prompt,
      systemInstruction,
      temperature: 0.1,
      maxOutputTokens: 250
    })
    let cleaned = cleanGeminiResponse(raw)
    // Strip any residual source annotations or citations
    cleaned = cleaned.replace(/\s*\*\*Source:\*\*[\s\S]*$/i, '').trim()
    cleaned = cleaned.replace(/\s*Source:[\s\S]*$/i, '').trim()
    cleaned = cleaned.replace(/^Answer:\s*/i, '').trim()
    
    // Find the most relevant source document
    const sourceDoc = contextSnippets[0]?.fileName || ''

    return {
      answer: cleaned,
      sourceDoc
    }
  } catch (err: any) {
    console.warn('Gemini QA error:', err?.message || err)
    return { answer: '' }
  }
}

/**
 * Extract targeted, concise answers for EACH file matching a specific search query
 */
export async function extractAnswersForResultsWithGemini({
  query,
  results
}: {
  query: string
  results: {
    original_name: string
    file_type: string
    fullText?: string
    topSnippets?: string[]
  }[]
}): Promise<Map<string, string>> {
  const answerMap = new Map<string, string>()

  if (!results || results.length === 0 || !query.trim()) return answerMap

  const filesContext = results.map((r, idx) => {
    const text = (r.fullText || (r.topSnippets || []).join('\n')).slice(0, 4000)
    return `=== Document ${idx + 1}: ${r.original_name} (${r.file_type}) ===\n${text}`
  }).join('\n\n')

  const prompt = `User Search Query: "${query}"

Below are documents retrieved for this query:

${filesContext}

Instructions:
For EACH document listed above:
1. Search the ENTIRE text of the document for the specific information requested in "${query}".
2. If the query specifies a name (e.g. "Rishi" or "Manoj") or topic, check whether this document is about that person/topic.
3. If the document MATCHES and contains the answer (e.g. CGPA, email, phone, skills, project, grade), extract ONLY the concise direct answer (e.g., "Rishi M Patel - CGPA: 8.1 (B.E. AI & DS at CMRIT)").
4. If the document is about a DIFFERENT person/topic or DOES NOT contain the answer, return "NO_MATCH".
5. Do NOT return full document summaries, resumes, or multi-paragraph dumps. Return ONLY the 1-sentence exact answer or "NO_MATCH".

Return ONLY a valid raw JSON object mapping the document's original_name to the extracted concise answer or "NO_MATCH":
{
  "filename1.pdf": "exact concise answer",
  "filename2.docx": "NO_MATCH"
}
Return ONLY valid raw JSON without code blocks.`

  const systemInstruction = `You extract precise, direct factual answers from document text for specific queries. If a document does not contain the requested answer or pertains to a different person, you output NO_MATCH.`

  try {
    const raw = await generateGeminiContent({
      prompt,
      systemInstruction,
      temperature: 0.1,
      maxOutputTokens: 1200
    })
    const cleaned = cleanGeminiResponse(raw)
    const parsed = JSON.parse(cleaned)
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === 'string' && val.trim().length > 0 && !val.includes('NO_MATCH') && !val.toLowerCase().includes('no direct answer')) {
        answerMap.set(key, val.trim())
      } else {
        answerMap.set(key, 'NO_MATCH')
      }
    }
  } catch (e: any) {
    console.warn('Gemini per-file answer extraction warning:', e?.message || e)
  }

  return answerMap
}
