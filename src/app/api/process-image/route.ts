import { NextRequest, NextResponse } from 'next/server'
import { processImage } from '@/lib/process-image'

export async function POST(req: NextRequest) {
  try {
    const { assetId } = await req.json()
    if (!assetId) {
      return NextResponse.json({ error: 'assetId required' }, { status: 400 })
    }

    await processImage(assetId)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
