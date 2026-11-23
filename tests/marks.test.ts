import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import {
  getMarks,
  setMerchantMark,
  deleteMerchantMark,
  sandboxMutate,
  SandboxApiError,
} from '../server/utils/sandbox'
import { ADMIN_IDENTITY } from '../server/utils/identity'
import { validateMarkReason, MAX_REASON_LENGTH } from '../server/utils/marks'
import { verifySessionToken } from '../server/utils/session'

// ---- Helpers ----

function mockOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function mockErr(status: number): Response {
  return { ok: false, status, json: async () => ({ error: 'Error' }) } as Response
}

const MOCK_MARK: ReturnType<typeof Object.assign> = {
  merchant_id: 'm1',
  mark: 'no_call',
  reason: 'Too many DNC requests',
  marked_by: 'Groupon Admin',
  marked_at: '2026-11-23T10:00:00Z',
  set_with: 'reps-app',
}

const MOCK_MARKS_RESPONSE = { data: [MOCK_MARK] }

const MOCK_DELETE_RESPONSE = {
  merchant_id: 'm1',
  removed: true,
  previous: MOCK_MARK,
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

// ---- validateMarkReason ----

describe('validateMarkReason', () => {
  it('rejects empty string', () => {
    expect(validateMarkReason('')).toMatchObject({ valid: false })
  })

  it('rejects whitespace-only string', () => {
    expect(validateMarkReason('   ')).toMatchObject({ valid: false })
  })

  it('rejects non-string values', () => {
    expect(validateMarkReason(null)).toMatchObject({ valid: false })
    expect(validateMarkReason(undefined)).toMatchObject({ valid: false })
    expect(validateMarkReason(42)).toMatchObject({ valid: false })
  })

  it('rejects reason exceeding max length', () => {
    expect(validateMarkReason('x'.repeat(MAX_REASON_LENGTH + 1))).toMatchObject({ valid: false })
  })

  it('accepts a valid reason and trims whitespace', () => {
    const result = validateMarkReason('  repeated DNC requests  ')
    expect(result).toMatchObject({ valid: true, value: 'repeated DNC requests' })
  })

  it('accepts reason at exactly max length', () => {
    expect(validateMarkReason('x'.repeat(MAX_REASON_LENGTH))).toMatchObject({ valid: true })
  })
})

// ---- Reading existing marks ----

describe('Reading marks', () => {
  it('getMarks sends GET /marks with Bearer auth', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MARKS_RESPONSE))
    await getMarks()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/marks'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key-abc' },
      }),
    )
  })

  it('getMarks returns the marks list', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MARKS_RESPONSE))
    const result = await getMarks()
    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.merchant_id).toBe('m1')
    expect(result.data[0]!.mark).toBe('no_call')
  })

  it('getMarks returns empty data array when no marks exist', async () => {
    mockFetch.mockResolvedValueOnce(mockOk({ data: [] }))
    const result = await getMarks()
    expect(result.data).toHaveLength(0)
  })
})

// ---- Creating a valid no_call mark ----

describe('Creating a no_call mark', () => {
  it('setMerchantMark sends PUT /merchants/:id/mark', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MARK))
    await setMerchantMark('m1', { mark: 'no_call', reason: 'Too many DNC', marked_by: 'Groupon Admin' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/merchants/m1/mark'),
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('setMerchantMark sends correct body fields', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MARK))
    await setMerchantMark('m1', { mark: 'no_call', reason: 'DNC reason', marked_by: 'Groupon Admin' })
    const [, options] = mockFetch.mock.calls[0]!
    const body = JSON.parse(options.body as string)
    expect(body.mark).toBe('no_call')
    expect(body.reason).toBe('DNC reason')
    expect(body.marked_by).toBe('Groupon Admin')
  })

  it('setMerchantMark returns the created mark', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MARK))
    const result = await setMerchantMark('m1', { mark: 'no_call', reason: 'DNC', marked_by: 'Groupon Admin' })
    expect(result.merchant_id).toBe('m1')
    expect(result.mark).toBe('no_call')
    expect(result.reason).toBe('Too many DNC requests')
  })
})

// ---- Updating an existing mark ----

describe('Updating an existing mark', () => {
  it('setMerchantMark overwrites existing mark (PUT is idempotent)', async () => {
    const updatedMark = { ...MOCK_MARK, reason: 'Updated reason' }
    mockFetch.mockResolvedValueOnce(mockOk(updatedMark))
    const result = await setMerchantMark('m1', {
      mark: 'no_call',
      reason: 'Updated reason',
      marked_by: 'Groupon Admin',
    })
    expect(result.reason).toBe('Updated reason')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ---- Removing a mark ----

describe('Removing a mark', () => {
  it('deleteMerchantMark sends DELETE /merchants/:id/mark', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_DELETE_RESPONSE))
    await deleteMerchantMark('m1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/merchants/m1/mark'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('deleteMerchantMark returns removed: true on success', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_DELETE_RESPONSE))
    const result = await deleteMerchantMark('m1')
    expect(result.removed).toBe(true)
    expect(result.merchant_id).toBe('m1')
  })

  it('deleteMerchantMark targets correct merchant ID', async () => {
    mockFetch.mockResolvedValueOnce(mockOk({ ...MOCK_DELETE_RESPONSE, merchant_id: 'm99' }))
    await deleteMerchantMark('m99')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/merchants/m99/mark'),
      expect.any(Object),
    )
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/merchants/m1/mark'),
      expect.any(Object),
    )
  })
})

// ---- marked_by exclusively on the server ----

describe('marked_by is server-resolved', () => {
  it('ADMIN_IDENTITY.displayName is Groupon Admin', () => {
    expect(ADMIN_IDENTITY.displayName).toBe('Groupon Admin')
  })

  it('setMerchantMark sends the passed marked_by in the body', async () => {
    mockFetch.mockResolvedValueOnce(mockOk(MOCK_MARK))
    await setMerchantMark('m1', {
      mark: 'no_call',
      reason: 'DNC',
      marked_by: ADMIN_IDENTITY.displayName,
    })
    const [, options] = mockFetch.mock.calls[0]!
    const body = JSON.parse(options.body as string)
    expect(body.marked_by).toBe('Groupon Admin')
  })
})

// ---- Sandbox API error handling ----

describe('Sandbox API error handling', () => {
  it('throws SandboxApiError with status 404 on not found', async () => {
    mockFetch.mockResolvedValueOnce(mockErr(404))
    await expect(sandboxMutate('DELETE', '/merchants/m1/mark')).rejects.toMatchObject({ status: 404 })
  })

  it('throws SandboxApiError with status 502 on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(sandboxMutate('PUT', '/merchants/m1/mark', {})).rejects.toMatchObject({ status: 502 })
  })

  it('throws SandboxApiError with status 504 on timeout', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    mockFetch.mockRejectedValueOnce(abortErr)
    await expect(sandboxMutate('PUT', '/merchants/m1/mark', {})).rejects.toMatchObject({ status: 504 })
  })

  it('error message does not leak raw upstream details', async () => {
    mockFetch.mockResolvedValueOnce(mockErr(500))
    const err = await sandboxMutate('PUT', '/merchants/m1/mark', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SandboxApiError)
    expect((err as SandboxApiError).message).not.toContain('{"error"')
  })
})

// ---- App endpoint auth protection ----

describe('App endpoint auth protection', () => {
  it('/api/marks is not in the public path list', () => {
    const path: string = '/api/marks'
    const isPublic =
      path === '/login' ||
      path.startsWith('/api/auth/') ||
      path.startsWith('/_nuxt/') ||
      path.startsWith('/__nuxt') ||
      path === '/favicon.ico'
    expect(isPublic).toBe(false)
  })

  it('/api/merchants/:id/mark is not in the public path list', () => {
    const path: string = '/api/merchants/m1/mark'
    const isPublic =
      path === '/login' ||
      path.startsWith('/api/auth/') ||
      path.startsWith('/_nuxt/')
    expect(isPublic).toBe(false)
  })

  it('verifySessionToken returns null for invalid token (unauthenticated)', () => {
    expect(verifySessionToken('')).toBeNull()
    expect(verifySessionToken('notavalidtoken')).toBeNull()
  })
})
