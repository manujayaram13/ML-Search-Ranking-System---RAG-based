import { NextRequest, NextResponse } from 'next/server'
import { searchWithSemanticAnswer } from '@/lib/search'

export async function POST(req: NextRequest) {
  try {
    const { query, limit = 15, useReranker = true } = await req.json()
    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ results: [], directAnswer: '', sourceDoc: '', useReranker })
    }

    const { results, directAnswer, sourceDoc } = await searchWithSemanticAnswer(query, limit, useReranker)
    return NextResponse.json({ results, directAnswer, sourceDoc, useReranker })
  } catch (err: any) {
    console.error('Search API Error:', err)
    return NextResponse.json({ error: err?.message || 'Search failed', results: [], directAnswer: '', sourceDoc: '', useReranker: true }, { status: 500 })
  }
}
