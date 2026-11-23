import { NextRequest, NextResponse } from 'next/server'
import { processDocument } from '@/lib/process-document'

export async function POST(req: NextRequest) {
  try {
    const { assetId } = await req.json()

    if (!assetId) {
      return NextResponse.json({ error: 'assetId is required' }, { status: 400 })
    }

    // Run processing (in real production we would use a queue)
    await processDocument(assetId)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
