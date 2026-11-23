import Groq from 'groq-sdk'

const groqApiKey = process.env.GROQ_API_KEY
if (!groqApiKey) {
  throw new Error('Missing GROQ_API_KEY environment variable')
}
const groq = new Groq({ apiKey: groqApiKey })

async function testGroq() {
  const text = `+6RISHI M PATEL Address: 253... QUALIFICATION Bachelor of Engineering in Artificial Intelligence & Data Science CMR Institute of Technology, Bengaluru CGPA: 8.1,2027[pursuing]`
  const query = 'rishi cgpa'

  const prompt = `User Query: "${query}"
Document: "1CR23AD102_RISHI_M_PATEL_RESUME.docx"
Content: """
${text}
"""

Extract ONLY the exact concise answer specifically matching "${query}".
If found, return e.g. "Rishi M Patel - CGPA: 8.1 (B.E. AI & DS at CMRIT)".
If not found or if document is about another person, return "NO_MATCH".
Return ONLY raw JSON: {"1CR23AD102_RISHI_M_PATEL_RESUME.docx": "answer"}`

  const res = await groq.chat.completions.create({
    model: 'qwen/qwen3.8-27b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1
  })

  console.log('Groq Response:', res.choices[0]?.message?.content)
}

testGroq().catch(console.error)
