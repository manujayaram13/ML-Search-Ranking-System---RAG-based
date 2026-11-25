import { NextResponse } from 'next/server'
import { getSupabaseConfig, isValidSupabaseConfig } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { url, anonKey } = getSupabaseConfig()
  if (!isValidSupabaseConfig(url, anonKey)) {
    return NextResponse.json(
      {
        error:
          'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or malformed on the server.',
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ url, anonKey })
}
