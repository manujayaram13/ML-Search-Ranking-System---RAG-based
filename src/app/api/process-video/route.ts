import { NextRequest, NextResponse } from 'next/server'
import { processVideo } from '@/lib/process-video'

export async function POST(req: NextRequest) {
  try {
    const { assetId } = await req.json()
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

    await processVideo(assetId)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
