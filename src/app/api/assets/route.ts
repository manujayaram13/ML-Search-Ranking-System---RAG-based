import { NextResponse } from 'next/server'
import { createServerSupabaseClient, resolveStorageUrl } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const CHUNK_SIZE = 100

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export async function GET() {
  try {
    const client = createServerSupabaseClient()

    const { data: assetsData, error: assetsErr } = await client
      .from('assets')
      .select('*')
      .order('created_at', { ascending: false })

    if (assetsErr) {
      throw new Error(`Failed to fetch assets: ${assetsErr.message}`)
    }

    if (!assetsData || assetsData.length === 0) {
      return NextResponse.json({ assets: [], mediaUrls: {} })
    }

    const assetIds = assetsData.map((a) => a.id)
    const segmentCountMap = new Map<string, number>()
    const segmentToAsset = new Map<string, string>()
    const segmentIds: string[] = []

    for (const batch of chunkArray(assetIds, CHUNK_SIZE)) {
      const { data: segmentsData, error: segErr } = await client
        .from('segments')
        .select('id, asset_id')
        .in('asset_id', batch)

      if (segErr) {
        throw new Error(`Failed to fetch segments: ${segErr.message}`)
      }

      for (const s of segmentsData || []) {
        segmentCountMap.set(s.asset_id, (segmentCountMap.get(s.asset_id) || 0) + 1)
        segmentToAsset.set(s.id, s.asset_id)
        segmentIds.push(s.id)
      }
    }

    const embeddingCountMap = new Map<string, number>()
    for (const batch of chunkArray(segmentIds, CHUNK_SIZE)) {
      const { data: embData, error: embErr } = await client
        .from('embeddings')
        .select('id, segment_id')
        .in('segment_id', batch)

      if (embErr) {
        throw new Error(`Failed to fetch embeddings: ${embErr.message}`)
      }

      for (const e of embData || []) {
        const assetId = segmentToAsset.get(e.segment_id)
        if (assetId) {
          embeddingCountMap.set(assetId, (embeddingCountMap.get(assetId) || 0) + 1)
        }
      }
    }

    const enrichedAssets = assetsData.map((asset) => ({
      ...asset,
      segment_count: segmentCountMap.get(asset.id) || 0,
      embedding_count: embeddingCountMap.get(asset.id) || 0,
    }))

    const mediaUrls: Record<string, string> = {}
    await Promise.all(
      enrichedAssets.map(async (asset) => {
        if (!asset.file_path) return
        const bucket =
          asset.file_type === 'image'
            ? 'images'
            : asset.file_type === 'video'
              ? 'videos'
              : 'documents'
        const key = `${bucket}:${asset.file_path}`
        mediaUrls[key] = await resolveStorageUrl(client, bucket, asset.file_path)
      })
    )

    return NextResponse.json({ assets: enrichedAssets, mediaUrls })
  } catch (err: any) {
    console.error('Assets API Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to load assets', assets: [], mediaUrls: {} },
      { status: 500 }
    )
  }
}
