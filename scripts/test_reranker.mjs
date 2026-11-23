import { rerankCandidatesWithXGBoost } from '../src/lib/reranker.ts'

console.log('Testing TypeScript XGBoost Reranker...')

const query = 'what is the thrust at sea level in falcon rocket specs'

const mockCandidates = [
  {
    score: 0.72,
    file_type: 'document',
    segment_type: 'chunk',
    importance_score: 0.70,
    content: 'General rocket staging overview and hydraulic actuators.'
  },
  {
    score: 0.81,
    file_type: 'document',
    segment_type: 'marks_and_scores',
    importance_score: 0.99,
    content: 'Technical Specifications: Thrust at Sea Level: 845 kN (190,000 lbf). Specific Impulse: 311s.'
  },
  {
    score: 0.75,
    file_type: 'image',
    segment_type: 'caption',
    importance: 0.90,
    content: 'Photo of rocket on launchpad.'
  }
]

const start = performance.now()
const reranked = rerankCandidatesWithXGBoost(query, mockCandidates)
const latency = (performance.now() - start).toFixed(2)

console.log(`\n✅ Reranking completed in ${latency} ms:`)
reranked.forEach((item, idx) => {
  console.log(`Rank ${idx + 1}: [Rerank Score: ${item.rerank_score} | Stage1: ${item.stage1_score}] (${item.segment_type}) ${item.content.slice(0, 50)}...`)
})
