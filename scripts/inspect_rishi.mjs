import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  const assetId = '0e271374-c7ec-4947-8f02-58524620e0a6'
  const { data: segs } = await supabase.from('segments').select('*').eq('asset_id', assetId)
  console.log(`Asset ${assetId} has ${segs?.length} segments:`)
  for (const s of segs || []) {
    console.log(`\n--- SEGMENT (${s.segment_type}) ---`)
    console.log(s.content)
  }
}

test().catch(console.error)
