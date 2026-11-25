import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, resolveStorageUrl } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: assetId } = await params
    if (!assetId) {
      return NextResponse.json({ error: 'Asset id is required' }, { status: 400 })
    }

    const client = createServerSupabaseClient()

    const { data: assetData, error: assetErr } = await client
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single()

    if (assetErr || !assetData) {
      return NextResponse.json(
        { error: assetErr?.message || 'Asset not found' },
        { status: 404 }
      )
    }

    const { data: segsData, error: segsErr } = await client
      .from('segments')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: true })

    if (segsErr) {
      throw new Error(`Failed to fetch segments: ${segsErr.message}`)
    }

    const segments = segsData || []
    const segmentIds = segments.map((s) => s.id)

    const embMap = new Map<string, any[]>()
    for (let i = 0; i < segmentIds.length; i += 100) {
      const batch = segmentIds.slice(i, i + 100)
      const { data: embData, error: embErr } = await client
        .from('embeddings')
        .select('*')
        .in('segment_id', batch)

      if (embErr) {
        throw new Error(`Failed to fetch embeddings: ${embErr.message}`)
      }

      for (const e of embData || []) {
        const list = embMap.get(e.segment_id) || []
        list.push(e)
        embMap.set(e.segment_id, list)
      }
    }

    const enrichedSegments = segments.map((s) => ({
      ...s,
      embeddings: embMap.get(s.id) || [],
    }))

    let mediaUrl = ''
    if (assetData.file_path) {
      const bucket =
        assetData.file_type === 'image'
          ? 'images'
          : assetData.file_type === 'video'
            ? 'videos'
            : 'documents'
      mediaUrl = await resolveStorageUrl(client, bucket, assetData.file_path)
    }

    const keyframeUrls: Record<string, string> = {}
    await Promise.all(
      enrichedSegments.map(async (seg) => {
        if (seg.segment_type === 'keyframe' && seg.metadata?.media_path) {
          const mediaPath = seg.metadata.media_path
          const resolved = await resolveStorageUrl(client, 'keyframes', mediaPath)
          if (resolved) keyframeUrls[mediaPath] = resolved
        }
      })
    )

    return NextResponse.json({
      asset: {
        ...assetData,
        segments: enrichedSegments,
      },
      mediaUrl,
      keyframeUrls,
    })
  } catch (err: any) {
    console.error('Asset Detail API Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to load asset details' },
      { status: 500 }
    )
  }
}
