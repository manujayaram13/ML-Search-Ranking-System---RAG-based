import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { assetIds } = await req.json()

    if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
      return NextResponse.json({ error: 'assetIds array is required' }, { status: 400 })
    }

    console.log(`=== Deleting ${assetIds.length} assets ===`, assetIds)

    // 1. Fetch assets to get file_path and file_type for storage deletion
    const { data: assetsToDelete, error: fetchAssetsErr } = await supabase
      .from('assets')
      .select('id, file_path, file_type')
      .in('id', assetIds)

    if (fetchAssetsErr) {
      throw new Error(`Failed to fetch assets: ${fetchAssetsErr.message}`)
    }

    // 2. Fetch all segments for these assets to get segment IDs and keyframe media paths
    const { data: segmentsToDelete, error: fetchSegsErr } = await supabase
      .from('segments')
      .select('id, metadata')
      .in('asset_id', assetIds)

    if (fetchSegsErr) {
      console.warn('Warning fetching segments:', fetchSegsErr.message)
    }

    const segmentIds = (segmentsToDelete || []).map(s => s.id)

    // 3. Delete embeddings
    if (segmentIds.length > 0) {
      const { error: embDeleteErr } = await supabase
        .from('embeddings')
        .delete()
        .in('segment_id', segmentIds)

      if (embDeleteErr) {
        console.warn('Warning deleting embeddings:', embDeleteErr.message)
      }
    }

    // 4. Delete segments
    const { error: segDeleteErr } = await supabase
      .from('segments')
      .delete()
      .in('asset_id', assetIds)

    if (segDeleteErr) {
      console.warn('Warning deleting segments:', segDeleteErr.message)
    }

    // 5. Delete assets from database
    const { error: assetDeleteErr } = await supabase
      .from('assets')
      .delete()
      .in('id', assetIds)

    if (assetDeleteErr) {
      throw new Error(`Failed to delete assets from database: ${assetDeleteErr.message}`)
    }

    // 6. Delete storage files
    for (const asset of assetsToDelete || []) {
      if (asset.file_path) {
        const bucket = asset.file_type === 'image' ? 'images' : asset.file_type === 'video' ? 'videos' : 'documents'
        try {
          await supabase.storage.from(bucket).remove([asset.file_path])
        } catch (storageErr) {
          console.warn(`Warning removing file from ${bucket}:`, storageErr)
        }
      }
    }

    // 7. Delete keyframe images from storage if any
    const keyframePaths: string[] = []
    for (const seg of segmentsToDelete || []) {
      const mediaPath = seg.metadata?.media_path
      if (mediaPath && typeof mediaPath === 'string') {
        keyframePaths.push(mediaPath)
      }
    }

    if (keyframePaths.length > 0) {
      try {
        await supabase.storage.from('keyframes').remove(keyframePaths)
      } catch (kfErr) {
        console.warn('Warning removing keyframes from storage:', kfErr)
      }
    }

    console.log(`Successfully deleted ${assetIds.length} assets and all associated records/files.`)
    return NextResponse.json({ success: true, deletedCount: assetIds.length })
  } catch (err: any) {
    console.error('Delete Asset Error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to delete asset(s)' }, { status: 500 })
  }
}
