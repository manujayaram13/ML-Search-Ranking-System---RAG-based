import Groq from 'groq-sdk'

const groqApiKey = process.env.GROQ_API_KEY
if (!groqApiKey) {
  throw new Error('Missing GROQ_API_KEY environment variable')
}
const groq = new Groq({ apiKey: groqApiKey })

async function testManoj() {
  const text = `Document Summary: This document is the resume of Manoj G J, an Artificial Intelligence and Machine Learning engineering student at CMR Institute of Technology (Batch 2027). CGPA: 8.4`
  const query = 'rishi cgpa'

  const prompt = `User Query: "${query}"
Document: "1CR23AI056_MANOJG_RESUME.pdf"
Content: """
${text}
"""

Extract ONLY the exact concise answer specifically matching "${query}".
If found, return e.g. "Rishi M Patel - CGPA: 8.1 (B.E. AI & DS at CMRIT)".
If not found or if document is about another person, return "NO_MATCH".
Return ONLY raw JSON: {"1CR23AI056_MANOJG_RESUME.pdf": "answer"}`

  const res = await groq.chat.completions.create({
    model: 'qwen/qwen3.8-27b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1
  })

  console.log('Groq Response for Manoj:', res.choices[0]?.message?.content)
}

testManoj().catch(console.error)
