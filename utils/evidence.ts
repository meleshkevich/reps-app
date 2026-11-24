/**
 * Evidence token map and validation — pure TypeScript, no Nuxt/API/LLM deps.
 *
 * Adapts the source-token pattern from a prior project: short request-scoped tokens
 * replace canonical IDs in model input so the model cannot fabricate or guess real IDs.
 * Every token is validated against the original evidence snapshot before signals are
 * returned to callers.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type EvidenceSourceType = 'note' | 'alert_reply' | 'review' | 'refund'

export interface EvidenceRecord {
  readonly sourceId: string
  readonly sourceType: EvidenceSourceType
  readonly merchantId: string
  readonly dealId: string | null
  readonly timestamp: string | null
  readonly text: string
}

export type EvidenceTokenMap = ReadonlyMap<string, EvidenceRecord>

export type SignalType =
  | 'restock_intent'
  | 'restock_refusal'
  | 'callback_requested'
  | 'capacity_risk'
  | 'refund_risk'
  | 'contact_restriction'
  | 'automation_mentioned'
  | 'other_relevant'

export interface VerifiedEvidenceRef {
  sourceToken: string
  sourceId: string
  sourceType: EvidenceSourceType
  merchantId: string
  dealId: string | null
  timestamp: string | null
  quote: string
}

export interface VerifiedSignal {
  type: SignalType
  evidence: VerifiedEvidenceRef[]
}

export interface EvidenceValidationIssue {
  code: string
  message: string
}

export type EvidenceValidationResult =
  | { ok: true; signals: VerifiedSignal[] }
  | { ok: false; issues: EvidenceValidationIssue[] }

// ---------------------------------------------------------------------------
// Token prefix map (category → prefix)
// ---------------------------------------------------------------------------

export const TOKEN_PREFIXES: Record<EvidenceSourceType, string> = {
  note: 'NOTE',
  alert_reply: 'ALERT',
  review: 'REVIEW',
  refund: 'REFUND',
}

// One-indexed positive integers only; no leading zeros.
export const TOKEN_PATTERN = /^(NOTE|ALERT|REVIEW|REFUND)_([1-9]\d*)$/

export const VALID_SIGNAL_TYPES = new Set<string>([
  'restock_intent',
  'restock_refusal',
  'callback_requested',
  'capacity_risk',
  'refund_risk',
  'contact_restriction',
  'automation_mentioned',
  'other_relevant',
])

// ---------------------------------------------------------------------------
// Token map construction
// ---------------------------------------------------------------------------

/**
 * Build a request-scoped token map from an ordered evidence snapshot.
 *
 * Same ordered snapshot → same tokens (deterministic).
 * Tokens are valid only for this request; never persist them.
 *
 * Throws if two records share the same sourceId within the same category.
 */
export function buildEvidenceTokenMap(records: readonly EvidenceRecord[]): EvidenceTokenMap {
  const map = new Map<string, EvidenceRecord>()
  const counters: Record<EvidenceSourceType, number> = {
    note: 0,
    alert_reply: 0,
    review: 0,
    refund: 0,
  }
  const seenIds: Record<EvidenceSourceType, Set<string>> = {
    note: new Set(),
    alert_reply: new Set(),
    review: new Set(),
    refund: new Set(),
  }

  for (const record of records) {
    const seen = seenIds[record.sourceType]
    if (seen.has(record.sourceId)) {
      throw new Error(
        `Duplicate canonical source ID '${record.sourceId}' in category '${record.sourceType}'`,
      )
    }
    seen.add(record.sourceId)
    counters[record.sourceType]++
    const token = `${TOKEN_PREFIXES[record.sourceType]}_${counters[record.sourceType]}`
    map.set(token, record)
  }

  return map
}

// ---------------------------------------------------------------------------
// Response validation and resolution
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate LLM structured output against the request-local token map.
 *
 * Checks schema, signal types, token format, token existence, category match,
 * merchant ownership, deal ownership, non-empty quotes, exact substring match,
 * and duplicate canonical references within a signal.
 *
 * Fail-closed: any failure returns ok:false with all collected issues.
 * Partially validated signals are never exposed.
 */
export function validateAndResolveEvidence(
  output: unknown,
  tokenMap: EvidenceTokenMap,
  merchantId: string,
  allowedDealIds: ReadonlySet<string>,
): EvidenceValidationResult {
  const issues: EvidenceValidationIssue[] = []
  const verifiedSignals: VerifiedSignal[] = []

  // 1. Top-level schema
  if (!isObject(output)) {
    return { ok: false, issues: [{ code: 'invalid_schema', message: 'Response is not an object' }] }
  }
  if (!Array.isArray(output.signals)) {
    return { ok: false, issues: [{ code: 'invalid_schema', message: 'signals is not an array' }] }
  }

  const rawSignals = output.signals as unknown[]

  for (let si = 0; si < rawSignals.length; si++) {
    const signal = rawSignals[si]

    // 2. Signal object schema
    if (!isObject(signal)) {
      issues.push({ code: 'invalid_signal_schema', message: `Signal[${si}] is not an object` })
      continue
    }

    const { type: sigType, evidence: rawEvidence } = signal

    // 3. Signal type
    if (typeof sigType !== 'string' || !VALID_SIGNAL_TYPES.has(sigType)) {
      issues.push({
        code: 'unsupported_signal_type',
        message: `Signal[${si}] type '${String(sigType)}' is not supported`,
      })
      continue
    }

    // 4. Non-empty evidence array
    if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
      issues.push({
        code: 'empty_evidence_array',
        message: `Signal[${si}] '${sigType}' has no evidence references`,
      })
      continue
    }

    const verifiedRefs: VerifiedEvidenceRef[] = []
    const seenCanonicals = new Set<string>() // reset per signal
    let signalInvalid = false

    for (let ri = 0; ri < rawEvidence.length; ri++) {
      const ref = rawEvidence[ri]

      if (!isObject(ref)) {
        issues.push({ code: 'invalid_ref_schema', message: `Signal[${si}] ref[${ri}] is not an object` })
        signalInvalid = true
        continue
      }

      const { sourceToken, quote } = ref

      // 5. Token format
      if (typeof sourceToken !== 'string' || !TOKEN_PATTERN.test(sourceToken)) {
        issues.push({
          code: 'invalid_token_format',
          message: `Signal[${si}] ref[${ri}]: invalid token format '${String(sourceToken)}'`,
        })
        signalInvalid = true
        continue
      }

      // 6. Token existence in request map
      const record = tokenMap.get(sourceToken)
      if (!record) {
        issues.push({
          code: 'unknown_token',
          message: `Signal[${si}] ref[${ri}]: token '${sourceToken}' not in request token map`,
        })
        signalInvalid = true
        continue
      }

      // 7. Token prefix matches source category
      const expectedPrefix = TOKEN_PREFIXES[record.sourceType]
      if (!sourceToken.startsWith(`${expectedPrefix}_`)) {
        issues.push({
          code: 'token_category_mismatch',
          message: `Signal[${si}] ref[${ri}]: token '${sourceToken}' category mismatch (expected ${expectedPrefix}_*)`,
        })
        signalInvalid = true
        continue
      }

      // 8. Merchant ownership
      if (record.merchantId !== merchantId) {
        issues.push({
          code: 'wrong_merchant',
          message: `Signal[${si}] ref[${ri}]: token '${sourceToken}' belongs to merchant '${record.merchantId}', not '${merchantId}'`,
        })
        signalInvalid = true
        continue
      }

      // 9. Deal ownership (where applicable)
      if (record.dealId !== null && !allowedDealIds.has(record.dealId)) {
        issues.push({
          code: 'invalid_deal',
          message: `Signal[${si}] ref[${ri}]: token '${sourceToken}' references deal '${record.dealId}' not in allowed deals`,
        })
        signalInvalid = true
        continue
      }

      // 10. Quote type and non-empty check
      if (typeof quote !== 'string') {
        issues.push({
          code: 'invalid_quote_type',
          message: `Signal[${si}] ref[${ri}]: quote is not a string`,
        })
        signalInvalid = true
        continue
      }

      if (quote.trim() === '') {
        issues.push({
          code: 'empty_quote',
          message: `Signal[${si}] ref[${ri}]: quote is empty or whitespace only`,
        })
        signalInvalid = true
        continue
      }

      // 11. Exact case-sensitive substring match (no trimming, no fuzzy)
      if (!record.text.includes(quote)) {
        issues.push({
          code: 'quote_not_found',
          message: `Signal[${si}] ref[${ri}]: quote not found in source text for token '${sourceToken}'`,
        })
        signalInvalid = true
        continue
      }

      // 12. Duplicate canonical reference within this signal
      const canonical = `${record.sourceType}:${record.sourceId}`
      if (seenCanonicals.has(canonical)) {
        issues.push({
          code: 'duplicate_ref',
          message: `Signal[${si}] ref[${ri}]: duplicate reference to '${canonical}' within signal '${sigType}'`,
        })
        signalInvalid = true
        continue
      }
      seenCanonicals.add(canonical)

      verifiedRefs.push({
        sourceToken,
        sourceId: record.sourceId,
        sourceType: record.sourceType,
        merchantId: record.merchantId,
        dealId: record.dealId,
        timestamp: record.timestamp,
        quote,
      })
    }

    if (!signalInvalid) {
      verifiedSignals.push({ type: sigType as SignalType, evidence: verifiedRefs })
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return { ok: true, signals: verifiedSignals }
}
