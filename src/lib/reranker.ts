import fs from 'fs'
import path from 'path'

interface XGBoostTree {
  left_children: number[]
  right_children: number[]
  split_indices: number[]
  split_conditions: number[]
  default_left: number[]
}

interface XGBoostModelJSON {
  learner: {
    gradient_booster: {
      model: {
        trees: XGBoostTree[]
      }
    }
  }
}

interface FeatureSchema {
  version?: string
  feature_columns: string[]
  numeric_features: string[]
  categorical_features: string[]
  metrics?: Record<string, number>
}

let cachedTrees: XGBoostTree[] | null = null
let cachedSchema: FeatureSchema | null = null

/**
 * Load and cache the Advanced XGBoost LTR model
 */
export function loadXGBoostModel(): { trees: XGBoostTree[]; schema: FeatureSchema } | null {
  if (cachedTrees && cachedSchema) {
    return { trees: cachedTrees, schema: cachedSchema }
  }

  try {
    const modelPath = path.resolve(process.cwd(), 'model', 'xgboost_ranker.json')
    const schemaPath = path.resolve(process.cwd(), 'model', 'feature_schema.json')

    if (!fs.existsSync(modelPath) || !fs.existsSync(schemaPath)) {
      console.warn('[XGBoost Ranker] Model or schema file not found, falling back to Stage 1 scores.')
      return null
    }

    const modelRaw = fs.readFileSync(modelPath, 'utf8')
    const schemaRaw = fs.readFileSync(schemaPath, 'utf8')

    const parsedModel: XGBoostModelJSON = JSON.parse(modelRaw)
    const parsedSchema: FeatureSchema = JSON.parse(schemaRaw)

    cachedTrees = parsedModel.learner.gradient_booster.model.trees
    cachedSchema = parsedSchema

    return { trees: cachedTrees, schema: cachedSchema }
  } catch (err: any) {
    console.error('[XGBoost Ranker] Error loading model:', err?.message || err)
    return null
  }
}

/**
 * Compute Lexical Token Overlap between Query and Candidate Content
 */
function computeLexicalOverlap(query: string, content: string): number {
  if (!query || !content) return 0
  const qTokens = new Set(query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean))
  const cTokens = new Set(content.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean))
  if (qTokens.size === 0 || cTokens.size === 0) return 0
  let matches = 0
  for (const t of qTokens) {
    if (cTokens.has(t)) matches++
  }
  return matches / qTokens.size
}

/**
 * Compute Character Tri-gram Jaccard Similarity
 */
function computeCharNgramSimilarity(query: string, content: string): number {
  if (!query || !content) return 0
  const qClean = query.toLowerCase().replace(/[^a-z0-9]/g, '')
  const cClean = content.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (qClean.length < 3 || cClean.length < 3) return 0
  const qNgrams = new Set<string>()
  for (let i = 0; i <= qClean.length - 3; i++) qNgrams.add(qClean.slice(i, i + 3))
  const cNgrams = new Set<string>()
  for (let i = 0; i <= cClean.length - 3; i++) cNgrams.add(cClean.slice(i, i + 3))
  let common = 0
  for (const ng of qNgrams) {
    if (cNgrams.has(ng)) common++
  }
  return common / Math.max(1, qNgrams.size)
}

/**
 * Compute BM25-like Term Frequency Saturation Score
 */
function computeBM25Approx(query: string, content: string): number {
  if (!query || !content) return 0
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (qWords.length === 0) return 0
  const cWords = content.toLowerCase().split(/\s+/).filter(Boolean)
  const docLen = cWords.length
  const avgLen = 25
  const k1 = 1.2
  const b = 0.75
  let score = 0
  for (const qw of qWords) {
    let tf = 0
    for (const cw of cWords) {
      if (cw.includes(qw)) tf++
    }
    const saturatedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgLen)))
    score += saturatedTf
  }
  return score / Math.max(1, qWords.length * 2)
}

/**
 * Check for exact entity/name matches in candidate text or filename
 */
function checkExactEntityMatch(query: string, text: string): number {
  if (!query || !text) return 0
  const qWords = query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 2)
  const tLower = text.toLowerCase()
  for (const w of qWords) {
    if (tLower.includes(w)) return 1
  }
  return 0
}

/**
 * Check if query is seeking specific facts or question answering
 */
function isQuestionQuery(query: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  return (
    q.includes('?') ||
    /^(what|who|where|when|why|how|which|tell|show|find|list|is|are|does|can)\b/.test(q) ||
    /(marks|score|grade|percentage|cgpa|gpa|qualification|education|skills|experience|salary|total|revenue|thrust|glucose|hba1c)/.test(q)
  ) ? 1 : 0
}

/**
 * Detect query intent type for feature encoding
 */
function detectQueryType(query: string): string {
  const q = query.toLowerCase().trim()
  if (/(marks|score|grade|percentage|cgpa|gpa|total|revenue|salary|cost|amount|price|reading|glucose|thrust|pressure|damages)/.test(q)) {
    return 'question_marks'
  }
  if (/(skill|languages|framework|experience|qualification|resume|cv|hiring|award)/.test(q)) {
    return 'question_skill'
  }
  if (/(video|clip|watch|tutorial|demo|presentation|speaking|action|lecture|recorded|timestamp)/.test(q)) {
    return 'video_action'
  }
  if (/(photo|image|picture|look|scenery|sunset|cat|dog|car|animal|nature|drawing|diagram|receipt|ocr|view)/.test(q)) {
    return 'visual_search'
  }
  if (/(summary|overview|explain|about|document|contract|spec|nda|architecture)/.test(q)) {
    return 'document_summary'
  }
  return 'broad_search'
}

/**
 * Query intent alignment calculation
 */
function computeQueryIntentAlignment(queryType: string, fileType: string, segmentType: string): number {
  if (queryType === 'question_marks' && segmentType === 'marks_and_scores') return 1.0
  if (queryType === 'document_summary' && segmentType === 'document_summary') return 1.0
  if (queryType === 'visual_search' && (fileType === 'image' || segmentType === 'caption')) return 1.0
  if (queryType === 'video_action' && (fileType === 'video' || segmentType === 'keyframe')) return 1.0
  if (queryType === 'question_skill' && (segmentType === 'key_points' || segmentType === 'marks_and_scores')) return 0.9
  return 0.3
}

/**
 * Extract feature vector matching the trained Advanced XGBoost feature columns
 */
function buildFeatureVector(
  query: string,
  candidate: {
    original_name?: string
    score: number
    file_type: string
    segment_type?: string
    importance_score?: number
    content?: string
    topSnippets?: string[]
    start_time?: number | null
    stage1_rank?: number
  },
  schema: FeatureSchema
): number[] {
  const queryWordCount = query.split(/\s+/).length
  const fullContent = [candidate.content, candidate.topSnippets?.join(' '), candidate.original_name].filter(Boolean).join(' ')
  const contentWordCount = fullContent.split(/\s+/).length
  const lengthRatio = queryWordCount / Math.max(1, contentWordCount)
  const logContentWords = Math.log1p(contentWordCount)
  const lexicalOverlap = computeLexicalOverlap(query, fullContent)
  const charNgramSim = computeCharNgramSimilarity(query, fullContent)
  const bm25Score = computeBM25Approx(query, fullContent)
  const exactMatch = checkExactEntityMatch(query, fullContent)
  const isQ = isQuestionQuery(query)
  const hasTimestamp = (candidate.start_time !== undefined && candidate.start_time !== null) ? 1 : 0
  const stage1Rank = candidate.stage1_rank ?? 1
  const rankDiscountSignal = 1.0 / Math.log2(1.0 + stage1Rank)

  // Infer segment_type if not explicitly set
  let segType = candidate.segment_type
  if (!segType) {
    if (candidate.file_type === 'image') {
      segType = lexicalOverlap > 0.5 ? 'caption' : 'ocr'
    } else if (candidate.file_type === 'video') {
      segType = hasTimestamp ? 'keyframe' : 'transcript_chunk'
    } else {
      segType = isQ ? 'marks_and_scores' : 'document_summary'
    }
  }

  // Infer importance score
  let importance = candidate.importance_score
  if (importance === undefined || importance === null) {
    if (segType === 'marks_and_scores') importance = 0.99
    else if (segType === 'caption' || segType === 'document_summary') importance = 0.95
    else if (segType === 'keyframe') importance = 0.92
    else if (segType === 'ocr' || segType === 'transcript_chunk') importance = 0.85
    else importance = 0.70
  }

  const cosineSim = candidate.score
  const queryType = detectQueryType(query)
  const intentAlignment = computeQueryIntentAlignment(queryType, candidate.file_type, segType)
  const isMarks = segType === 'marks_and_scores' ? 1 : 0
  const questionMarksAffinity = isQ * isMarks
  const semanticLexicalInter = cosineSim * lexicalOverlap
  const semanticExactInter = cosineSim * exactMatch
  const importanceWeightedSim = importance * cosineSim

  const featureMap: Record<string, number> = {
    cosine_similarity: cosineSim,
    lexical_overlap: lexicalOverlap,
    exact_name_match: exactMatch,
    bm25_score: bm25Score,
    char_ngram_similarity: charNgramSim,
    semantic_lexical_interaction: semanticLexicalInter,
    semantic_exact_interaction: semanticExactInter,
    importance_weighted_similarity: importanceWeightedSim,
    intent_alignment: intentAlignment,
    rank_discount_signal: rankDiscountSignal,
    importance_score: importance,
    is_question: isQ,
    question_marks_affinity: questionMarksAffinity,
    has_timestamp: hasTimestamp,
    query_word_count: queryWordCount,
    content_word_count: contentWordCount,
    length_ratio: lengthRatio,
    log_content_words: logContentWords
  }

  // One-hot file_type
  if (candidate.file_type === 'document') featureMap['file_type_document'] = 1
  if (candidate.file_type === 'image') featureMap['file_type_image'] = 1
  if (candidate.file_type === 'video') featureMap['file_type_video'] = 1

  // One-hot segment_type
  featureMap[`segment_type_${segType}`] = 1

  // One-hot query_type
  featureMap[`query_type_${queryType}`] = 1

  // Category inference
  if (queryType === 'visual_search' || candidate.file_type === 'image') {
    featureMap['category_visual_images'] = 1
  } else if (queryType === 'video_action' || candidate.file_type === 'video') {
    featureMap['category_video_multimedia'] = 1
  } else if (queryType === 'question_marks' || queryType === 'question_skill') {
    featureMap['category_education_academics'] = 1
  }

  return schema.feature_columns.map(col => featureMap[col] ?? 0)
}

/**
 * Evaluate single candidate through the boosted trees
 */
function predictTreeScore(features: number[], trees: XGBoostTree[]): number {
  let score = 0
  const numTrees = trees.length

  for (let i = 0; i < numTrees; i++) {
    const tree = trees[i]
    let node = 0

    while (tree.left_children[node] !== -1) {
      const featIdx = tree.split_indices[node]
      const threshold = tree.split_conditions[node]
      const val = features[featIdx] ?? 0

      if (val < threshold) {
        node = tree.left_children[node]
      } else {
        node = tree.right_children[node]
      }
    }

    score += tree.split_conditions[node]
  }

  return score
}

/**
 * Stage 2 Advanced XGBoost Reranking:
 * Evaluates candidate retrieved items through the LambdaMART boosted trees ensemble
 */
export function rerankCandidatesWithXGBoost<T extends {
  original_name?: string
  score: number
  file_type: string
  segment_type?: string
  importance_score?: number
  content?: string
  topSnippets?: string[]
  start_time?: number | null
}>(
  query: string,
  candidates: T[]
): (T & { rerank_score: number; stage1_score: number; reranked: boolean })[] {
  if (!candidates || candidates.length === 0) {
    return []
  }

  if (candidates.length === 1) {
    return candidates.map(c => ({
      ...c,
      stage1_score: c.score,
      rerank_score: c.score,
      reranked: true
    }))
  }

  const modelData = loadXGBoostModel()
  if (!modelData) {
    return candidates.map(c => ({
      ...c,
      stage1_score: c.score,
      rerank_score: c.score,
      reranked: false
    }))
  }

  const { trees, schema } = modelData

  const scoredCandidates = candidates.map((cand, idx) => {
    const features = buildFeatureVector(query, { ...cand, stage1_rank: idx + 1 }, schema)
    const rawTreeScore = predictTreeScore(features, trees)

    // Sigmoid probability scaling
    const sigmoided = 1 / (1 + Math.exp(-rawTreeScore / 2.2))
    
    // High-precision blend: 75% XGBoost advanced ranking decision + 25% cosine baseline
    const finalScore = Number((0.75 * sigmoided + 0.25 * cand.score).toFixed(4))

    return {
      ...cand,
      score: finalScore, // Update score for display
      stage1_score: cand.score,
      rerank_score: finalScore,
      reranked: true
    }
  })

  // Sort candidates strictly in descending order of relevance
  scoredCandidates.sort((a, b) => b.rerank_score - a.rerank_score)

  return scoredCandidates
}
