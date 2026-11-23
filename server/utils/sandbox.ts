const SANDBOX_BASE = 'https://desk-production-6adc.up.railway.app/api/sandbox/v1'
const TIMEOUT_MS = 10_000

// ---- Types from OpenAPI spec ----

export interface TodaySoldOut {
  sold_out_id: string
  restock_task_id: string
  deal_id: string
  deal_name: string
  merchant_id: string
  merchant_name: string
  category: string
  region: string
  city: string
  size_band: string
  rep_id: string
  rep_name: string
  do_not_contact: boolean
  cap: number
  sold_out_at: string
  team_time: string
  world_day: string
  posted_in_channel: boolean
}

export interface Merchant {
  merchant_id: string
  merchant_name: string
  category: string
  region: string
  city: string
  size_band: string
  rep_id: string
  rep_name: string | null
  joined: string
  do_not_contact: boolean
}

export interface Deal {
  deal_id: string
  merchant_id: string
  sold_out_count: number
  first_sold_out: string | null
  last_sold_out: string | null
  last_cap: number | null
}

export interface PaginatedResponse<T> {
  data: T[]
  next_cursor: string | null
  total: number
}

export interface SoldOutsTodayResponse extends PaginatedResponse<TodaySoldOut> {
  world_day: string
  date: string
  team_time: string
}

export interface Mark {
  merchant_id: string
  mark: string
  reason: string
  marked_by: string
  marked_at: string
  set_with: string
}

export interface MarksResponse {
  data: Mark[]
}

export interface DeleteMarkResponse {
  merchant_id: string
  removed: boolean
  previous: Mark
}

// ---- Error class ----

export class SandboxApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SandboxApiError'
  }
}

// ---- Internal helpers ----

function getApiKey(): string {
  const key = process.env.GROUPON_API_KEY
  if (!key) throw new SandboxApiError(503, 'GROUPON_API_KEY not configured')
  return key
}

export async function sandboxFetch<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${SANDBOX_BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new SandboxApiError(res.status, `Sandbox API returned ${res.status}`)
    }

    return (await res.json()) as T
  } catch (err) {
    if (err instanceof SandboxApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SandboxApiError(504, 'Sandbox API request timed out')
    }
    throw new SandboxApiError(502, 'Sandbox API unavailable')
  } finally {
    clearTimeout(timer)
  }
}

// ---- Public API functions ----

export async function getSoldoutsToday(
  params: { cursor?: string; limit?: number } = {},
): Promise<SoldOutsTodayResponse> {
  return sandboxFetch<SoldOutsTodayResponse>('/soldouts/today', params)
}

export async function getMerchants(
  params: { cursor?: string; limit?: number; q?: string; category?: string; region?: string; rep_id?: string } = {},
): Promise<PaginatedResponse<Merchant>> {
  return sandboxFetch<PaginatedResponse<Merchant>>('/merchants', params)
}

export async function getMerchantDeals(
  merchantId: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<PaginatedResponse<Deal>> {
  return sandboxFetch<PaginatedResponse<Deal>>('/deals', { merchant_id: merchantId, ...params })
}

export async function sandboxMutate<T>(
  method: 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${SANDBOX_BASE}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    if (!res.ok) throw new SandboxApiError(res.status, `Sandbox API returned ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof SandboxApiError) throw err
    if (err instanceof Error && err.name === 'AbortError')
      throw new SandboxApiError(504, 'Sandbox API request timed out')
    throw new SandboxApiError(502, 'Sandbox API unavailable')
  } finally {
    clearTimeout(timer)
  }
}

export async function getMarks(): Promise<MarksResponse> {
  return sandboxFetch<MarksResponse>('/marks')
}

export async function setMerchantMark(
  merchantId: string,
  body: { mark: string; reason: string; marked_by: string },
): Promise<Mark> {
  return sandboxMutate<Mark>('PUT', `/merchants/${merchantId}/mark`, body)
}

export async function deleteMerchantMark(merchantId: string): Promise<DeleteMarkResponse> {
  return sandboxMutate<DeleteMarkResponse>('DELETE', `/merchants/${merchantId}/mark`)
}
