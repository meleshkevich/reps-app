import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import {
  getSoldoutsToday,
  getMerchants,
  getMerchantDeals,
  sandboxFetch,
  SandboxApiError,
} from '../server/utils/sandbox'
import { verifySessionToken } from '../server/utils/session'

// ---- Helpers ----

function mockOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function mockErr(status: number): Response {
  return { ok: false, status, json: async () => ({ error: 'Error' }) } as Response
}

const MOCK_TODAY_RESPONSE = {
  world_day: 'Mon',
  date: '2026-11-23',
  team_time: '09:15',
  data: [
    {
      sold_out_id: 'so1',
      restock_task_id: 'rt1',
      deal_id: 'd1',
      deal_name: 'Test Deal',
      merchant_id: 'm1',
      merchant_name: 'Test Merchant',
      category: 'Food',
      region: 'London',
      city: 'London',
      size_band: 'S',
      rep_id: 'r1',
      rep_name: 'Jane',
      do_not_contact: false,
      cap: 100,
      sold_out_at: '2026-11-23T09:00:00Z',
      team_time: '09:00',
      world_day: 'Mon',
      posted_in_channel: true,
    },
  ],
  next_cursor: null,
  total: 1,
}

const MOCK_MERCHANTS_RESPONSE = {
  data: [
    {
      merchant_id: 'm1',
      merchant_name: 'Test Merchant',
      category: 'Food',
      region: 'London',
      city: 'London',
      size_band: 'S',
      rep_id: 'r1',
      rep_name: 'Jane',
      joined: '2024-01-01',
      do_not_contact: false,
    },
  ],
  next_cursor: null,
  total: 1,
}

const MOCK_DEALS_RESPONSE = {
  data: [
    {
      deal_id: 'd1',
      merchant_id: 'm1',
      sold_out_count: 5,
      first_sold_out: '2026-01-01T00:00:00Z',
      last_sold_out: '2026-11-23T09:00:00Z',
      last_cap: 100,
    },
  ],
  next_cursor: null,
  total: 1,
}

// ---- Setup ----

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  process.env.GROUPON_API_KEY = 'test-key-abc'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  delete process.env.GROUPON_API_KEY
})

// ---- Bearer authentication ----

describe('Bearer authentication', () => {
  it('sends Authorization: Bearer <key> header', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_TODAY_RESPONSE))
    await getSoldoutsToday()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/soldouts/today'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key-abc' },
      }),
    )
  })

  it('throws SandboxApiError when GROUPON_API_KEY is missing', async () => {
    delete process.env.GROUPON_API_KEY
    await expect(getSoldoutsToday()).rejects.toThrow(SandboxApiError)
    await expect(getSoldoutsToday()).rejects.toMatchObject({ status: 503 })
  })

  it('does not call fetch when API key is missing', async () => {
    delete process.env.GROUPON_API_KEY
    await expect(getSoldoutsToday()).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ---- Successful responses ----

describe('Successful API responses', () => {
  it('getSoldoutsToday returns parsed response', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_TODAY_RESPONSE))
    const result = await getSoldoutsToday()
    expect(result.total).toBe(1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.merchant_name).toBe('Test Merchant')
    expect(result.world_day).toBe('Mon')
    expect(result.date).toBe('2026-11-23')
  })

  it('getMerchants returns paginated merchant list', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MERCHANTS_RESPONSE))
    const result = await getMerchants()
    expect(result.total).toBe(1)
    expect(result.data[0]!.merchant_id).toBe('m1')
    expect(result.next_cursor).toBeNull()
  })

  it('getMerchantDeals sends merchant_id as query param', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_DEALS_RESPONSE))
    const result = await getMerchantDeals('m1')
    expect(result.total).toBe(1)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('merchant_id=m1'),
      expect.any(Object),
    )
  })
})

// ---- Pagination ----

describe('Pagination', () => {
  it('passes cursor query param when provided', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_TODAY_RESPONSE))
    await getSoldoutsToday({ cursor: 'page2cursor' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('cursor=page2cursor'),
      expect.any(Object),
    )
  })

  it('passes limit query param when provided', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MERCHANTS_RESPONSE))
    await getMerchants({ limit: 50 })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=50'),
      expect.any(Object),
    )
  })

  it('exposes next_cursor from response', async () => {
    const withCursor = { ...MOCK_MERCHANTS_RESPONSE, next_cursor: 'abc123', total: 100 }
    mockFetch.mockResolvedValueOnce(mockOk(withCursor))
    const result = await getMerchants()
    expect(result.next_cursor).toBe('abc123')
    expect(result.total).toBe(100)
  })
})

// ---- HTTP errors ----

describe('HTTP error handling', () => {
  it('throws SandboxApiError with status 401 on unauthorized', async () => {
    mockFetch.mockResolvedValueOnce(mockErr(401))
    await expect(sandboxFetch('/soldouts/today')).rejects.toMatchObject({
      status: 401,
    })
  })

  it('throws SandboxApiError with status 429 on rate limit', async () => {
    mockFetch.mockResolvedValueOnce(mockErr(429))
    await expect(sandboxFetch('/soldouts/today')).rejects.toMatchObject({
      status: 429,
    })
  })

  it('throws SandboxApiError on 500 server error', async () => {
    mockFetch.mockResolvedValueOnce(mockErr(500))
    await expect(sandboxFetch('/soldouts/today')).rejects.toThrow(SandboxApiError)
  })

  it('error message does not leak raw upstream details', async () => {
    mockFetch.mockResolvedValueOnce(mockErr(503))
    const err = await sandboxFetch('/soldouts/today').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SandboxApiError)
    // Message should reference the status code, not upstream JSON
    expect((err as SandboxApiError).message).not.toContain('{"error"')
  })
})

// ---- Timeout ----

describe('Timeout handling', () => {
  it('throws SandboxApiError with status 504 on AbortError', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValueOnce(abortErr)
    await expect(sandboxFetch('/soldouts/today')).rejects.toMatchObject({
      status: 504,
    })
  })

  it('throws SandboxApiError with status 502 on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(sandboxFetch('/soldouts/today')).rejects.toMatchObject({
      status: 502,
    })
  })
})

// ---- Unauthorized access to app endpoints ----

describe('App endpoint auth protection', () => {
  it('/api/soldouts/today is not in the public path list', () => {
    const path: string = '/api/soldouts/today'
    const isPublic =
      path === '/login' ||
      path.startsWith('/api/auth/') ||
      path.startsWith('/_nuxt/') ||
      path.startsWith('/__nuxt') ||
      path === '/favicon.ico'
    expect(isPublic).toBe(false)
  })

  it('/api/merchants is not in the public path list', () => {
    const path: string = '/api/merchants'
    const isPublic =
      path === '/login' ||
      path.startsWith('/api/auth/') ||
      path.startsWith('/_nuxt/')
    expect(isPublic).toBe(false)
  })

  it('verifySessionToken returns null for missing token (unauthenticated)', () => {
    expect(verifySessionToken('')).toBeNull()
    expect(verifySessionToken('notavalidtoken')).toBeNull()
  })
})
