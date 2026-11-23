import { searchWithSemanticAnswer } from '../src/lib/search.js'

async function run() {
  console.log('Testing search query: "rishi cgpa"...')
  const res = await searchWithSemanticAnswer('rishi cgpa')
  console.log('\n--- RESULTS ---')
  for (const r of res.results) {
    console.log(`\nFile: ${r.original_name} (Score: ${r.score})`)
    console.log(`Answer: ${r.answer}`)
  }
}

run().catch(console.error)
