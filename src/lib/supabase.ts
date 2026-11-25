import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function sanitizeEnvValue(value?: string | null): string {
  if (!value) return ''
  const cleaned = value
    .replace(/[\r\n]/g, '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
  if (!cleaned || cleaned === 'undefined' || cleaned === 'null') {
    return ''
  }
  return cleaned
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  const url = sanitizeEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  )
  const anonKey = sanitizeEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  )
  return { url, anonKey }
}

export function isValidSupabaseConfig(url: string, anonKey: string): boolean {
  if (!url || !anonKey) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function createServerSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig()
  if (!isValidSupabaseConfig(url, anonKey)) {
    throw new Error(
      'Missing or invalid NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.'
    )
  }
  return createClient(url, anonKey)
}

const initialConfig = getSupabaseConfig()
let cachedServerClient: SupabaseClient | null = isValidSupabaseConfig(
  initialConfig.url,
  initialConfig.anonKey
)
  ? createClient(initialConfig.url, initialConfig.anonKey)
  : null

function getOrCreateClient(): SupabaseClient {
  if (!cachedServerClient) {
    cachedServerClient = createServerSupabaseClient()
  }
  return cachedServerClient
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getOrCreateClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

let cachedBrowserClient: SupabaseClient | null = null

export async function getBrowserSupabase(): Promise<SupabaseClient> {
  if (cachedBrowserClient) return cachedBrowserClient

  const buildUrl = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const buildAnonKey = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  if (isValidSupabaseConfig(buildUrl, buildAnonKey)) {
    cachedBrowserClient = createClient(buildUrl, buildAnonKey)
    return cachedBrowserClient
  }

  const res = await fetch('/api/supabase-config', { cache: 'no-store' })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Failed to load Supabase configuration from server.')
  }

  const runtimeUrl = sanitizeEnvValue(data.url)
  const runtimeAnonKey = sanitizeEnvValue(data.anonKey)
  if (!isValidSupabaseConfig(runtimeUrl, runtimeAnonKey)) {
    throw new Error('Server returned invalid Supabase configuration.')
  }

  cachedBrowserClient = createClient(runtimeUrl, runtimeAnonKey)
  return cachedBrowserClient
}

export async function resolveStorageUrl(
  client: SupabaseClient,
  bucket: string,
  filePath: string
): Promise<string> {
  if (!filePath) return ''
  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(filePath, 7200)
    if (!error && data?.signedUrl) {
      return data.signedUrl
    }
  } catch {
    // Fall through to public URL
  }

  const { data: pubData } = client.storage.from(bucket).getPublicUrl(filePath)
  return pubData?.publicUrl || ''
}
