# LLM Evidence Analysis: Architecture and Design

> **Status:** Implemented (T4). Gateway corrected to use `output_config.format` structured JSON output (T4 correction). Smoke test status documented at the end of this file.

---

## Purpose

The evidence analysis feature uses an LLM to extract restock-related signals from unstructured merchant data (rep notes, merchant replies, customer reviews, refund reasons). It surfaces supporting quotes with verified source references.

The LLM extracts evidence only. It does not generate financial estimates, recommendations, or operational decisions.

---

## Source Token Architecture

Adapted from a prior project's `sourceTokenMap.ts` pattern. The core problem it solves: LLMs can fabricate source IDs. If the model is given actual database IDs (like `note-001` or `rev-00782`), it may cite IDs that do not exist or belong to the wrong merchant.

**Solution:** Replace canonical IDs with short, request-scoped tokens.

### How it works

1. After evidence is collected and normalized, `buildEvidenceTokenMap(records)` assigns each record a short token: `NOTE_1`, `ALERT_2`, `REVIEW_1`, `REFUND_1`, etc.
2. The model receives tokens in its input, not canonical IDs.
3. The model's output cites tokens and exact quotes.
4. `validateAndResolveEvidence(output, tokenMap, merchantId, allowedDealIds)` checks every cited token against the request-local map, verifies the quote is a substring of the original source text, and resolves canonical metadata from the map — never from the model's output.

### Token format

```
{CATEGORY}_{INDEX}
```

- Categories: `NOTE`, `ALERT`, `REVIEW`, `REFUND`
- Index: one-indexed, no leading zeros (`NOTE_1`, `NOTE_2`, not `NOTE_0` or `NOTE_01`)
- Tokens exist only for the current analysis request; they are never persisted

### Synthetic example

**Input to model:**
```json
{
  "merchant_id": "M001",
  "evidence": [
    {
      "token": "NOTE_1",
      "sourceType": "note",
      "date": "2026-11-20",
      "text": "Merchant can release another 20 vouchers next week."
    }
  ]
}
```

**Valid model output:**
```json
{
  "signals": [
    {
      "type": "restock_intent",
      "evidence": [
        {
          "sourceToken": "NOTE_1",
          "quote": "Merchant can release another 20 vouchers next week."
        }
      ]
    }
  ]
}
```

**Invalid model output (fabricated quote):**
```json
{
  "signals": [
    {
      "type": "restock_intent",
      "evidence": [
        {
          "sourceToken": "NOTE_1",
          "quote": "wants to add more vouchers soon"
        }
      ]
    }
  ]
}
```

This is rejected with `code: 'quote_not_found'` because the quote is not a case-sensitive substring of the source text.

---

## Request-Local Mapping and Canonical ID Resolution

- The token map is built from the current evidence snapshot, used for the LLM call, and used immediately for validation.
- The same ordered snapshot always produces the same tokens (deterministic).
- Tokens are never rebuilt from a fresh API fetch during validation — the caller passes the same map object.
- Canonical metadata (source ID, source type, merchant ID, deal ID, timestamp) comes from the map, not the model output.

---

## Exact-Quote Verification

```typescript
record.text.includes(quote)
```

- Case-sensitive, no normalization, no trimming before matching.
- Partial quotes (substrings) are accepted — the model is not required to quote the full source text.
- Whitespace-only quotes are rejected before the substring check.
- Paraphrased, invented or case-mismatched quotes fail.

This establishes **reference integrity** (the quote exists in the source) but not **semantic correctness** (the quote says what the signal claims). Human review remains necessary.

---

## Fail-Closed Validation

`validateAndResolveEvidence` returns a discriminated union:

```typescript
type EvidenceValidationResult =
  | { ok: true; signals: VerifiedSignal[] }
  | { ok: false; issues: EvidenceValidationIssue[] }
```

If any validation check fails (schema, signal type, token format, token existence, category mismatch, merchant ownership, deal ownership, empty quote, quote not found, duplicate reference within a signal), the **entire analysis** is rejected. Partially validated signals are never exposed.

Validation checks performed in order:

1. Top-level schema (object with `signals` array)
2. Signal type is a supported value
3. Evidence array is non-empty
4. Each reference: token format is valid
5. Each reference: token exists in the request-local map
6. Each reference: token prefix matches the mapped source category
7. Each reference: record belongs to the requested merchant
8. Each reference: deal ID (where applicable) is in the allowed set
9. Each reference: quote is a non-empty, non-whitespace string
10. Each reference: quote is a case-sensitive substring of source text
11. Each reference: no duplicate canonical source within the same signal

---

## Merchant and Deal Ownership Checks

Before calling the LLM, the endpoint fetches the merchant's deals from the sandbox. This set is passed through to both `collectEvidence` (to filter reviews and refunds) and `validateAndResolveEvidence` (to verify cited deals).

Evidence records:
- Notes and alert replies are merchant-level (no deal ID); merchant ownership is verified.
- Reviews and refunds have a `deal_id`; both merchant and deal ownership are verified.

Evidence submitted to the model is pre-filtered to the requesting merchant. Validation re-checks independently.

---

## Evidence Sampling Limits

| Limit | Value |
|---|---|
| Maximum records per category | 10 |
| Maximum records total | 40 |
| Maximum evidence characters total | 20,000 |

Records are selected newest first within each category. When the total/character limit applies, oversized records are skipped rather than truncated (complete records are preferred).

The sampling notice in the UI states: "Analyzed N evidence records (sample, not complete history)."

---

## Session-Local Rep Feedback

"Confirm evidence" and "Flag incorrect" buttons are session-local only. Feedback is not persisted to the sandbox or any backend store. The UI explicitly labels this: "session only — not persisted."

Rep feedback is separate from T3 merchant-level no-call marks.

---

## Cost Controls

| Control | Implementation |
|---|---|
| One LLM call per analysis action | Enforced in endpoint; no background or bulk calls |
| Bounded output tokens | `max_tokens: 2048` |
| Explicit timeout | 30 seconds (`AbortController`) |
| No automatic retries | Single call; failures returned to UI |
| Budget exhaustion response | 402 from gateway → `llm_unavailable` to browser |
| No evidence in logs | Only usage/cost metadata logged (gateway policy) |
| All credentials server-side | API key read from `process.env`, never sent to browser |

---

## Remaining Semantic Hallucination Risks

The model may generate invalid source tokens, but deterministic application validation prevents invalid references and unsupported quotes from being accepted as source-verified evidence. The source-token pattern does not prevent:

- **Invented source tokens**: The model may cite `NOTE_99` when only `NOTE_1` exists. Validation rejects the entire analysis — any token not in the request-scoped map causes a fail-closed rejection.
- **Misclassified signal type**: The model attributes a quote to the wrong signal type (e.g., labels a refund complaint as `restock_intent`).
- **Selective quoting**: The model picks a quote that is technically in the source but misleads in context.
- **Missing signals**: The model fails to identify a relevant signal.
- **Cross-signal pairing**: A quote from one record is cited under a signal where it is semantically irrelevant.

Quote verification establishes reference integrity, not semantic truth. Human review is required before acting on signals.

---

## Deliberate Scope Cuts

| Item | Reason |
|---|---|
| Vector databases / embeddings | Not required for exact-substring verification |
| RAG infrastructure | Evidence is bounded and fits in a single prompt |
| Multi-step reasoning | Single extraction call is sufficient for the signal types defined |
| Automated hallucination repair | Fail-closed: reject and inform, do not auto-repair |
| Persistent AI analysis history | Out of scope for this MVP |
| LLM-generated financial estimates | Explicitly excluded; financial engine is deterministic |
| Automated routing decisions | Out of scope; signals inform human decisions |
| Pagination across all evidence | First page (up to 100 records per source, bounded to 10 per category) |

---

## Gateway Smoke Test

**Status:** Performed (T4 correction, 2026-11-24).

**Merchant:** M10001 (Bright Skin & Spa)  
**Evidence collected:** 5 notes, 5 alert-replies (10 records total)  
**Model reported by gateway:** `claude-haiku-5-5`  
**Stop reason:** `end_turn`  
**Token usage:** input_tokens=943, output_tokens=210  
**Signals found:** 4

| Signal type | Token | Quote |
|---|---|---|
| `capacity_risk` | NOTE_1 | "keeps cap at 60, won't go higher" |
| `restock_refusal` | NOTE_1 | "won't go higher" |
| `contact_restriction` | NOTE_3 | "T happy at 60. leave" |
| `callback_requested` | NOTE_4 | "T back Wednesday. left card" |

**Gateway format validated:** `output_config: { format: { type: "json_schema", schema: { additionalProperties: false, ... } } }` — the gateway requires `additionalProperties: false` on all object types and does not accept a `json_schema` wrapper key.

All quotes were verified as exact substrings by the application's `validateAndResolveEvidence` layer. No retries were performed.
