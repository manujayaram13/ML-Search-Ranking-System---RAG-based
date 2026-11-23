import Groq from 'groq-sdk'

const groqApiKey = process.env.GROQ_API_KEY
if (!groqApiKey) {
  throw new Error('Missing GROQ_API_KEY environment variable')
}
const groq = new Groq({ apiKey: groqApiKey })

async function listModels() {
  const models = await groq.models.list()
  console.log('Available Groq models:', models.data.map(m => m.id))
}

listModels().catch(console.error)
