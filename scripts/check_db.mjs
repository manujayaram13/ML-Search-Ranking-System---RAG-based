import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  const { data: assets } = await supabase.from('assets').select('*')
  console.log('--- ASSETS ---')
  for (const a of assets || []) {
    console.log(`\n=== ASSET: ${a.original_name} (${a.id}) ===`)
    const { data: segs } = await supabase.from('segments').select('*').eq('asset_id', a.id)
    console.log(`Segments count: ${segs?.length || 0}`)
    for (const s of segs || []) {
      console.log(`\n--- [Type: ${s.segment_type}] (Score: ${s.importance_score}) ---`)
      console.log(s.content)
    }
  }
}

test().catch(console.error)
