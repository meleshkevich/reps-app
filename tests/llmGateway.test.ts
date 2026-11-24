import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callLLM } from '../server/utils/llmGateway'
import { buildEvidenceTokenMap } from '../utils/evidence'
import type { EvidenceRecord } from '../utils/evidence'

// ---- Fixtures ----

function mkRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    sourceId: 'note-001',
    sourceType: 'note',
    merchantId: 'M001',
    dealId: null,
    timestamp: '2026-11-01T10:00:00Z',
    text: 'Merchant can release another 20 vouchers next week.',
    ...overrides,
  }
}

const NOTE_1 = mkRecord({ sourceId: 'note-001', sourceType: 'note', text: 'Merchant can release another 20 vouchers.' })

function buildTokenMap() {
  return buildEvidenceTokenMap([NOTE_1])
}

const MERCHANT_ID = 'M001'

const VALID_RESPONSE_BODY = {
  stop_reason: 'end_turn',
  model: 'claude-haiku-5-5',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        signals: [
          {
            type: 'restock_intent',
            evidence: [{ sourceToken: 'NOTE_1', quote: 'release another 20 vouchers' }],
          },
        ],
      }),
    },
  ],
  usage: { input_tokens: 100, output_tokens: 50 },
}

const EMPTY_SIGNALS_BODY = {
  stop_reason: 'end_turn',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: JSON.stringify({ signals: [] }) }],
  usage: { input_tokens: 80, output_tokens: 10 },
}

type MockResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const response: MockResponse = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
  return vi.fn().mockResolvedValueOnce(response)
}

beforeEach(() => {
  process.env.GROUPON_API_KEY = 'test-api-key'
})

afterEach(() => {
  delete process.env.GROUPON_API_KEY
  vi.unstubAllGlobals()
})

// ---- Request shape tests ----

describe('callLLM — request shape', () => {
  it('sends output_config.format with json_schema (not tools/tool_choice)', async () => {
    const fetched = mockFetch(200, VALID_RESPONSE_BODY)
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    expect(fetched).toHaveBeenCalledOnce()
    const [, init] = fetched.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)

    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body).toHaveProperty('output_config.format.type', 'json_schema')
    expect(body).toHaveProperty('output_config.format.schema.required')
    expect(body).not.toHaveProperty('output_config.format.json_schema')
  })

  it('sends thinking: { type: "disabled" }', async () => {
    const fetched = mockFetch(200, VALID_RESPONSE_BODY)
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    const [, init] = fetched.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('targets the correct model', async () => {
    const fetched = mockFetch(200, VALID_RESPONSE_BODY)
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    const [, init] = fetched.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('claude-haiku-5-5')
  })

  it('includes the merchant evidence in messages', async () => {
    const fetched = mockFetch(200, VALID_RESPONSE_BODY)
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    const [, init] = fetched.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    const content = JSON.parse(body.messages[0].content)
    expect(content.merchant_id).toBe(MERCHANT_ID)
    expect(content.evidence).toHaveLength(1)
    expect(content.evidence[0].token).toBe('NOTE_1')
  })

  it('sends the Authorization Bearer token', async () => {
    const fetched = mockFetch(200, VALID_RESPONSE_BODY)
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    const [, init] = fetched.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-api-key')
  })

  it('sends the JSON schema for all 8 signal types', async () => {
    const fetched = mockFetch(200, VALID_RESPONSE_BODY)
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    const [, init] = fetched.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const enumValues =
      body.output_config.format.schema.properties.signals.items.properties.type.enum
    expect(enumValues).toEqual(
      expect.arrayContaining([
        'restock_intent',
        'restock_refusal',
        'callback_requested',
        'capacity_risk',
        'refund_risk',
        'contact_restriction',
        'automation_mentioned',
        'other_relevant',
      ]),
    )
    expect(enumValues).toHaveLength(8)
  })
})

// ---- Successful response parsing ----

describe('callLLM — successful response', () => {
  it('returns ok:true with rawOutput parsed from text block', async () => {
    vi.stubGlobal('fetch', mockFetch(200, VALID_RESPONSE_BODY))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.rawOutput as { signals: unknown[] }).signals).toHaveLength(1)
      expect(result.model).toBe('claude-haiku-5-5')
      expect(result.usage?.input_tokens).toBe(100)
      expect(result.usage?.output_tokens).toBe(50)
    }
  })

  it('returns ok:true with empty signals array', async () => {
    vi.stubGlobal('fetch', mockFetch(200, EMPTY_SIGNALS_BODY))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.rawOutput as { signals: unknown[] }).signals).toHaveLength(0)
    }
  })

  it('returns usage metadata from the response', async () => {
    vi.stubGlobal('fetch', mockFetch(200, VALID_RESPONSE_BODY))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 50 })
    }
  })
})

// ---- Malformed and incomplete responses ----

describe('callLLM — malformed and incomplete responses', () => {
  it('rejects when stop_reason is not end_turn (truncation: max_tokens)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        stop_reason: 'max_tokens',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: '{"signals":[' }],
        usage: { input_tokens: 100, output_tokens: 2048 },
      }),
    )

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('stop_reason=max_tokens')
  })

  it('rejects when stop_reason is stop_sequence', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        stop_reason: 'stop_sequence',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: '{"signals":[]}' }],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    )

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('stop_reason=stop_sequence')
  })

  it('rejects when content array has no text block', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        stop_reason: 'end_turn',
        model: 'claude-haiku-5-5',
        content: [],
        usage: { input_tokens: 100, output_tokens: 0 },
      }),
    )

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('missing text content block')
  })

  it('rejects when text block contains invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        stop_reason: 'end_turn',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: 'not json at all' }],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    )

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('not valid JSON')
  })

  it('rejects when text block is empty', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        stop_reason: 'end_turn',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: '' }],
        usage: { input_tokens: 100, output_tokens: 0 },
      }),
    )

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('missing text content block')
  })

  it('rejects truncated JSON where stop_reason is max_tokens', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        stop_reason: 'max_tokens',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: '{"signals":[{"type":"restock_intent"' }],
        usage: { input_tokens: 200, output_tokens: 2048 },
      }),
    )

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('stop_reason=max_tokens')
  })
})

// ---- Gateway HTTP failures ----

describe('callLLM — gateway HTTP failures', () => {
  it('returns ok:false with httpStatus 400 for a bad request', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { error: 'bad request' }))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(400)
      expect(result.error).toContain('400')
    }
  })

  it('returns ok:false for 402 (budget exhausted)', async () => {
    vi.stubGlobal('fetch', mockFetch(402, {}))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(402)
      expect(result.error).toContain('budget')
    }
  })

  it('returns ok:false for 429 (rate limit)', async () => {
    vi.stubGlobal('fetch', mockFetch(429, {}))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(429)
      expect(result.error).toContain('rate limit')
    }
  })

  it('returns ok:false for 500 (server error)', async () => {
    vi.stubGlobal('fetch', mockFetch(500, {}))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.httpStatus).toBe(500)
      expect(result.error).toContain('500')
    }
  })
})

// ---- Timeout ----

describe('callLLM — timeout', () => {
  it('returns ok:false when the request is aborted (timeout)', async () => {
    const abortErr = new Error('The operation was aborted')
    abortErr.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(abortErr))

    const result = await callLLM(MERCHANT_ID, buildTokenMap())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('timed out')
  })
})

// ---- No automatic retries ----

describe('callLLM — no automatic retries', () => {
  it('calls fetch exactly once on HTTP 500', async () => {
    const fetched = mockFetch(500, {})
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    expect(fetched).toHaveBeenCalledOnce()
  })

  it('calls fetch exactly once on network error', async () => {
    const fetched = vi.fn().mockRejectedValueOnce(new Error('network error'))
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    expect(fetched).toHaveBeenCalledOnce()
  })

  it('calls fetch exactly once when the response has invalid JSON text', async () => {
    const fetched = mockFetch(200, {
      stop_reason: 'end_turn',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: '{broken' }],
      usage: { input_tokens: 100, output_tokens: 10 },
    })
    vi.stubGlobal('fetch', fetched)

    await callLLM(MERCHANT_ID, buildTokenMap())

    expect(fetched).toHaveBeenCalledOnce()
  })
})

// ---- Empty evidence guard ----

describe('callLLM — empty evidence guard', () => {
  it('returns ok:false without calling fetch when tokenMap is empty', async () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)

    const emptyMap = buildEvidenceTokenMap([])
    const result = await callLLM(MERCHANT_ID, emptyMap)

    expect(result.ok).toBe(false)
    expect(fetched).not.toHaveBeenCalled()
  })
})
