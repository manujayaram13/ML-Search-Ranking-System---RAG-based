import { extractAnswersForResultsWithGemini } from '../src/lib/gemini.ts'

if (!process.env.GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY environment variable')
}

async function test() {
  const query = 'rishi cgpa'
  const text = `+6RISHI M PATEL Address: 253, DT Kingston Luxury Gents PG, 1st cross Kundalahalli Colony... QUALIFICATION Bachelor of Engineering in Artificial Intelligence & Data Science CMR Institute of Technology, Bengaluru CGPA: 8.1,2027[pursuing]`

  const res = await extractAnswersForResultsWithGemini({
    query,
    results: [
      {
        original_name: '1CR23AD102_RISHI_M_PATEL_RESUME.docx',
        file_type: 'document',
        fullText: text
      },
      {
        original_name: '1CR23AI056_MANOJG_RESUME.pdf',
        file_type: 'document',
        fullText: 'Document of Manoj G J, AI & ML engineering student. CGPA: 8.4'
      }
    ]
  })

  console.log('Result map:', Array.from(res.entries()))
}

test().catch(console.error)
