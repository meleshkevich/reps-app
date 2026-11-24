import { describe, it, expect } from 'vitest'
import {
  buildEvidenceTokenMap,
  validateAndResolveEvidence,
  TOKEN_PATTERN,
  TOKEN_PREFIXES,
  type EvidenceRecord,
  type EvidenceTokenMap,
} from '../utils/evidence'

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

const NOTE_1 = mkRecord({ sourceId: 'note-001', sourceType: 'note', text: 'Merchant can release another 20 vouchers next week.' })
const NOTE_2 = mkRecord({ sourceId: 'note-002', sourceType: 'note', text: 'Second note text.' })
const ALERT_1 = mkRecord({ sourceId: 'alert-001', sourceType: 'alert_reply', text: 'We can do 30 more.' })
const REVIEW_1 = mkRecord({ sourceId: 'rev-001', sourceType: 'review', dealId: 'D001', text: 'Great product, refund needed.' })
const REFUND_1 = mkRecord({ sourceId: 'ref-001', sourceType: 'refund', dealId: 'D001', text: 'Item not as described.' })

const ALLOWED_DEALS = new Set(['D001', 'D002'])
const MERCHANT_ID = 'M001'

// ---- Token mapping tests ----

describe('buildEvidenceTokenMap', () => {
  it('assigns NOTE_1 to the first note', () => {
    const map = buildEvidenceTokenMap([NOTE_1])
    expect(map.get('NOTE_1')).toBe(NOTE_1)
  })

  it('produces the same tokens for the same ordered snapshot (stable)', () => {
    const records = [NOTE_1, ALERT_1, REVIEW_1]
    const a = buildEvidenceTokenMap(records)
    const b = buildEvidenceTokenMap(records)
    expect([...a.keys()]).toEqual([...b.keys()])
    for (const [token, rec] of a) {
      expect(b.get(token)).toBe(rec)
    }
  })

  it('assigns independent counters across all four categories', () => {
    const map = buildEvidenceTokenMap([NOTE_1, ALERT_1, REVIEW_1, REFUND_1])
    expect(map.get('NOTE_1')).toBe(NOTE_1)
    expect(map.get('ALERT_1')).toBe(ALERT_1)
    expect(map.get('REVIEW_1')).toBe(REVIEW_1)
    expect(map.get('REFUND_1')).toBe(REFUND_1)
    expect(map.size).toBe(4)
  })

  it('increments counters per category, not globally', () => {
    const map = buildEvidenceTokenMap([NOTE_1, NOTE_2, ALERT_1])
    expect(map.get('NOTE_1')).toBe(NOTE_1)
    expect(map.get('NOTE_2')).toBe(NOTE_2)
    expect(map.get('ALERT_1')).toBe(ALERT_1)
    expect(map.has('NOTE_3')).toBe(false)
    expect(map.has('ALERT_2')).toBe(false)
  })

  it('resolves canonical source ID from token', () => {
    const map = buildEvidenceTokenMap([NOTE_1])
    expect(map.get('NOTE_1')?.sourceId).toBe('note-001')
  })

  it('throws on duplicate canonical source ID within the same category', () => {
    const dup = mkRecord({ sourceId: 'note-001', sourceType: 'note' })
    expect(() => buildEvidenceTokenMap([NOTE_1, dup])).toThrow('Duplicate canonical source ID')
  })

  it('allows the same sourceId in different categories (no cross-category conflict)', () => {
    const sameId = mkRecord({ sourceId: 'shared-id', sourceType: 'note' })
    const sameIdOther = mkRecord({ sourceId: 'shared-id', sourceType: 'alert_reply' })
    expect(() => buildEvidenceTokenMap([sameId, sameIdOther])).not.toThrow()
  })

  it('handles an empty records array', () => {
    const map = buildEvidenceTokenMap([])
    expect(map.size).toBe(0)
  })

  it('assigns correct prefix per source type', () => {
    const map = buildEvidenceTokenMap([NOTE_1, ALERT_1, REVIEW_1, REFUND_1])
    expect([...map.keys()]).toEqual(expect.arrayContaining(['NOTE_1', 'ALERT_1', 'REVIEW_1', 'REFUND_1']))
    for (const [token, record] of map) {
      const prefix = TOKEN_PREFIXES[record.sourceType]
      expect(token).toMatch(new RegExp(`^${prefix}_`))
    }
  })
})

// ---- TOKEN_PATTERN tests ----

describe('TOKEN_PATTERN', () => {
  it('accepts valid tokens', () => {
    expect(TOKEN_PATTERN.test('NOTE_1')).toBe(true)
    expect(TOKEN_PATTERN.test('ALERT_12')).toBe(true)
    expect(TOKEN_PATTERN.test('REVIEW_99')).toBe(true)
    expect(TOKEN_PATTERN.test('REFUND_1000')).toBe(true)
  })

  it('rejects NOTE_0 (zero is not one-indexed)', () => {
    expect(TOKEN_PATTERN.test('NOTE_0')).toBe(false)
  })

  it('rejects NOTE_01 (leading zero)', () => {
    expect(TOKEN_PATTERN.test('NOTE_01')).toBe(false)
  })

  it('rejects NOTE_-1 (negative suffix)', () => {
    expect(TOKEN_PATTERN.test('NOTE_-1')).toBe(false)
  })

  it('rejects tokens without numeric suffix', () => {
    expect(TOKEN_PATTERN.test('NOTE_')).toBe(false)
    expect(TOKEN_PATTERN.test('NOTE')).toBe(false)
  })

  it('rejects unknown category prefixes', () => {
    expect(TOKEN_PATTERN.test('FOO_1')).toBe(false)
    expect(TOKEN_PATTERN.test('note_1')).toBe(false)
  })

  it('rejects canonical IDs that happen to resemble tokens but have wrong prefix', () => {
    expect(TOKEN_PATTERN.test('note-001')).toBe(false)
    expect(TOKEN_PATTERN.test('rev-001')).toBe(false)
  })
})

// ---- validateAndResolveEvidence tests ----

function buildMap(records: EvidenceRecord[]): EvidenceTokenMap {
  return buildEvidenceTokenMap(records)
}

describe('validateAndResolveEvidence — valid cases', () => {
  it('accepts a valid exact quote', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'Merchant can release another 20 vouchers next week.' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.signals).toHaveLength(1)
      expect(result.signals[0].type).toBe('restock_intent')
      expect(result.signals[0].evidence[0].quote).toBe('Merchant can release another 20 vouchers next week.')
      expect(result.signals[0].evidence[0].sourceId).toBe('note-001')
    }
  })

  it('accepts a partial exact quote (substring)', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'release another 20 vouchers' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(true)
  })

  it('accepts an empty signals array', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence({ signals: [] }, tokenMap, MERCHANT_ID, ALLOWED_DEALS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.signals).toHaveLength(0)
  })

  it('allows the same source across different signals', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      {
        signals: [
          { type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'release another 20 vouchers' }] },
          { type: 'callback_requested', evidence: [{ sourceToken: 'NOTE_1', quote: 'next week' }] },
        ],
      },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.signals).toHaveLength(2)
  })

  it('resolves canonical metadata from token (not from model output)', () => {
    const tokenMap = buildMap([REVIEW_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'refund_risk', evidence: [{ sourceToken: 'REVIEW_1', quote: 'refund needed' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      const ref = result.signals[0].evidence[0]
      expect(ref.sourceId).toBe('rev-001')
      expect(ref.sourceType).toBe('review')
      expect(ref.dealId).toBe('D001')
      expect(ref.merchantId).toBe('M001')
    }
  })
})

describe('validateAndResolveEvidence — quote failures', () => {
  it('rejects an invented/paraphrased quote', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'wants to add more vouchers soon' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'quote_not_found')).toBe(true)
  })

  it('rejects a quote copied from a different source record', () => {
    const tokenMap = buildMap([NOTE_1, ALERT_1])
    // Quote is from ALERT_1 but submitted for NOTE_1
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'We can do 30 more.' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'quote_not_found')).toBe(true)
  })

  it('rejects a case-mismatched quote', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'MERCHANT CAN RELEASE ANOTHER 20 VOUCHERS' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'quote_not_found')).toBe(true)
  })

  it('rejects an empty string quote', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: '' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'empty_quote')).toBe(true)
  })

  it('rejects a whitespace-only quote', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: '   ' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'empty_quote')).toBe(true)
  })
})

describe('validateAndResolveEvidence — ownership failures', () => {
  it('rejects a cross-merchant reference', () => {
    const wrongMerchantRecord = mkRecord({ sourceId: 'note-x', merchantId: 'M999', text: 'other merchant' })
    const tokenMap = buildMap([wrongMerchantRecord])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'other merchant' }] }] },
      tokenMap,
      MERCHANT_ID, // requesting M001 but record is M999
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'wrong_merchant')).toBe(true)
  })

  it('rejects a reference with an unallowed deal ID', () => {
    const reviewBadDeal = mkRecord({ sourceId: 'rev-999', sourceType: 'review', dealId: 'D-UNKNOWN', text: 'bad deal review' })
    const tokenMap = buildMap([reviewBadDeal])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'refund_risk', evidence: [{ sourceToken: 'REVIEW_1', quote: 'bad deal review' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS, // D-UNKNOWN not in ALLOWED_DEALS
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'invalid_deal')).toBe(true)
  })
})

describe('validateAndResolveEvidence — token failures', () => {
  it('rejects an unknown token not in the map', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_99', quote: 'anything' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'unknown_token')).toBe(true)
  })

  it('rejects a malformed token format', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'note-001', quote: 'x' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'invalid_token_format')).toBe(true)
  })

  it('rejects a canonical ID submitted as a token (wrong format)', () => {
    const tokenMap = buildMap([NOTE_1])
    // A canonical ID like 'note-001' doesn't match TOKEN_PATTERN
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'note-001', quote: 'Merchant can release' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'invalid_token_format')).toBe(true)
  })

  it('rejects a token with wrong category prefix for the mapped record', () => {
    // Map has NOTE_1 pointing to a note record; model returns REVIEW_1 (which is not in map)
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'REVIEW_1', quote: 'x' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    // REVIEW_1 not in map → unknown_token (map only has NOTE_1)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'unknown_token')).toBe(true)
  })

  it('rejects NOTE_0 (invalid numeric suffix)', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_0', quote: 'x' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'invalid_token_format')).toBe(true)
  })
})

describe('validateAndResolveEvidence — signal-level failures', () => {
  it('rejects an unsupported signal type', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'made_up_signal', evidence: [{ sourceToken: 'NOTE_1', quote: 'x' }] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'unsupported_signal_type')).toBe(true)
  })

  it('rejects a signal with an empty evidence array', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      { signals: [{ type: 'restock_intent', evidence: [] }] },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'empty_evidence_array')).toBe(true)
  })

  it('rejects duplicate canonical references within the same signal', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      {
        signals: [
          {
            type: 'restock_intent',
            evidence: [
              { sourceToken: 'NOTE_1', quote: 'Merchant can release' },
              { sourceToken: 'NOTE_1', quote: 'another 20 vouchers' }, // same canonical
            ],
          },
        ],
      },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((i) => i.code === 'duplicate_ref')).toBe(true)
  })
})

describe('validateAndResolveEvidence — schema failures', () => {
  it('rejects a non-object response', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence('not an object', tokenMap, MERCHANT_ID, ALLOWED_DEALS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0].code).toBe('invalid_schema')
  })

  it('rejects response without signals array', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence({ data: [] }, tokenMap, MERCHANT_ID, ALLOWED_DEALS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0].code).toBe('invalid_schema')
  })

  it('rejects null response', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(null, tokenMap, MERCHANT_ID, ALLOWED_DEALS)
    expect(result.ok).toBe(false)
  })
})

describe('validateAndResolveEvidence — fail-closed behavior', () => {
  it('one invalid reference rejects the entire analysis (not just that signal)', () => {
    const tokenMap = buildMap([NOTE_1, NOTE_2])
    const result = validateAndResolveEvidence(
      {
        signals: [
          { type: 'restock_intent', evidence: [{ sourceToken: 'NOTE_1', quote: 'Merchant can release another 20 vouchers next week.' }] },
          { type: 'callback_requested', evidence: [{ sourceToken: 'NOTE_2', quote: 'INVENTED QUOTE NOT IN TEXT' }] },
        ],
      },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    // The whole result is rejected even though signal 1 would have been valid
    if (!result.ok) expect(result.issues.some((i) => i.code === 'quote_not_found')).toBe(true)
  })

  it('collects all issues rather than stopping at the first one', () => {
    const tokenMap = buildMap([NOTE_1])
    const result = validateAndResolveEvidence(
      {
        signals: [
          { type: 'bad_type_1', evidence: [{ sourceToken: 'NOTE_1', quote: 'x' }] },
          { type: 'bad_type_2', evidence: [{ sourceToken: 'NOTE_1', quote: 'x' }] },
        ],
      },
      tokenMap,
      MERCHANT_ID,
      ALLOWED_DEALS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.length).toBeGreaterThanOrEqual(2)
  })
})

// ---- Integration behavior tests ----

describe('integration — finance and marks behavior unchanged', () => {
  it('importing from utils/evidence does not affect utils/finance', async () => {
    const { getRecommendation } = await import('../utils/finance')
    const rec = getRecommendation({
      hasNoCallMark: true,
      hasDoNotContact: false,
      hasActiveAutoReplenish: null,
      financialResults: {
        low: { repTimeCostPence: null, provisionalIncrementalGPPence: null, netExpectedGPPence: null, isComplete: false, missingInputs: [], warnings: [], errors: [] },
        base: { repTimeCostPence: null, provisionalIncrementalGPPence: null, netExpectedGPPence: null, isComplete: false, missingInputs: [], warnings: [], errors: [] },
        high: { repTimeCostPence: null, provisionalIncrementalGPPence: null, netExpectedGPPence: null, isComplete: false, missingInputs: [], warnings: [], errors: [] },
      },
    })
    expect(rec.recommendation).toBe('dont_bother')
  })
})

describe('integration — LLM mock behavior', () => {
  it('no_evidence path skips LLM (demonstrated via pure function test)', () => {
    // When collectEvidence returns 0 records, the endpoint returns no_evidence.
    // We verify the token map is empty and validation of empty signals is valid.
    const emptyMap = buildEvidenceTokenMap([])
    const result = validateAndResolveEvidence({ signals: [] }, emptyMap, MERCHANT_ID, ALLOWED_DEALS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.signals).toHaveLength(0)
  })

  it('buildEvidenceTokenMap is deterministic for the same input (gateway mock stability)', () => {
    const records = [NOTE_1, ALERT_1, REVIEW_1, REFUND_1]
    const map1 = buildEvidenceTokenMap(records)
    const map2 = buildEvidenceTokenMap(records)
    expect([...map1.keys()]).toEqual([...map2.keys()])
  })
})
