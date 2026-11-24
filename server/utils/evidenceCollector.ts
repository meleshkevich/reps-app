/**
 * Server-side evidence collection from the Sandbox API.
 *
 * Fetches notes, alert replies, reviews and refunds for a merchant,
 * normalises them into EvidenceRecord, verifies ownership, deduplicates,
 * and applies bounded selection (10/category, 40 total, 20 k chars).
 *
 * If any required source cannot be retrieved, returns incomplete:true
 * so the caller can skip the LLM and return an incomplete-evidence state.
 */

import type { EvidenceRecord, EvidenceSourceType } from '~/utils/evidence'
import {
  getMerchantNotes,
  getMerchantAlertReplies,
  getMerchantReviews,
  getMerchantRefunds,
  type RepNote,
  type AlertReply,
  type Review,
  type Refund,
} from './sandbox'

const MAX_PER_CATEGORY = 10
const MAX_TOTAL = 40
const MAX_CHARS = 20_000

interface SourceResult {
  records: EvidenceRecord[]
  status: 'ok' | 'failed'
  error?: string
}

export interface SamplingMeta {
  totalFetched: number
  totalSelected: number
  bySource: Record<EvidenceSourceType, { fetched: number; selected: number; status: 'ok' | 'failed'; error?: string }>
}

export interface CollectionResult {
  records: EvidenceRecord[]
  samplingMeta: SamplingMeta
  incomplete: boolean
  failedSources: EvidenceSourceType[]
}

// ---- Per-source fetch helpers ----

function sortByTimestampDesc(a: EvidenceRecord, b: EvidenceRecord): number {
  const ta = a.timestamp ?? ''
  const tb = b.timestamp ?? ''
  if (tb !== ta) return tb < ta ? -1 : 1
  return a.sourceId < b.sourceId ? -1 : 1
}

async function fetchNotes(merchantId: string): Promise<SourceResult> {
  try {
    const response = await getMerchantNotes(merchantId)
    const records: EvidenceRecord[] = []
    const seen = new Set<string>()
    for (const n of response.data as RepNote[]) {
      if (!n.note_id || !n.text?.trim() || n.merchant_id !== merchantId || seen.has(n.note_id)) continue
      seen.add(n.note_id)
      records.push({
        sourceId: n.note_id,
        sourceType: 'note',
        merchantId: n.merchant_id,
        dealId: null,
        timestamp: n.created_at ?? null,
        text: n.text,
      })
    }
    return { records, status: 'ok' }
  } catch {
    return { records: [], status: 'failed', error: 'notes' }
  }
}

async function fetchAlertReplies(merchantId: string): Promise<SourceResult> {
  try {
    const response = await getMerchantAlertReplies(merchantId)
    const records: EvidenceRecord[] = []
    const seen = new Set<string>()
    for (const a of response.data as AlertReply[]) {
      if (!a.reply_id || !a.text?.trim() || a.merchant_id !== merchantId || seen.has(a.reply_id)) continue
      seen.add(a.reply_id)
      records.push({
        sourceId: a.reply_id,
        sourceType: 'alert_reply',
        merchantId: a.merchant_id,
        dealId: null,
        timestamp: a.received_at ?? null,
        text: a.text,
      })
    }
    return { records, status: 'ok' }
  } catch {
    return { records: [], status: 'failed', error: 'alert_replies' }
  }
}

async function fetchReviews(merchantId: string, allowedDealIds: ReadonlySet<string>): Promise<SourceResult> {
  try {
    const response = await getMerchantReviews(merchantId)
    const records: EvidenceRecord[] = []
    const seen = new Set<string>()
    for (const r of response.data as Review[]) {
      if (
        !r.review_id ||
        !r.text?.trim() ||
        r.merchant_id !== merchantId ||
        seen.has(r.review_id) ||
        (r.deal_id && !allowedDealIds.has(r.deal_id))
      ) continue
      seen.add(r.review_id)
      records.push({
        sourceId: r.review_id,
        sourceType: 'review',
        merchantId: r.merchant_id,
        dealId: r.deal_id ?? null,
        timestamp: r.created_at ?? null,
        text: r.text,
      })
    }
    return { records, status: 'ok' }
  } catch {
    return { records: [], status: 'failed', error: 'reviews' }
  }
}

async function fetchRefunds(merchantId: string, allowedDealIds: ReadonlySet<string>): Promise<SourceResult> {
  try {
    const response = await getMerchantRefunds(merchantId)
    const records: EvidenceRecord[] = []
    const seen = new Set<string>()
    for (const r of response.data as Refund[]) {
      if (
        !r.refund_id ||
        !r.reason_text?.trim() ||
        r.merchant_id !== merchantId ||
        seen.has(r.refund_id) ||
        (r.deal_id && !allowedDealIds.has(r.deal_id))
      ) continue
      seen.add(r.refund_id)
      records.push({
        sourceId: r.refund_id,
        sourceType: 'refund',
        merchantId: r.merchant_id,
        dealId: r.deal_id ?? null,
        timestamp: r.created_at ?? null,
        text: r.reason_text,
      })
    }
    return { records, status: 'ok' }
  } catch {
    return { records: [], status: 'failed', error: 'refunds' }
  }
}

// ---- Main collection function ----

export async function collectEvidence(
  merchantId: string,
  allowedDealIds: ReadonlySet<string>,
): Promise<CollectionResult> {
  const [notesResult, alertsResult, reviewsResult, refundsResult] = await Promise.all([
    fetchNotes(merchantId),
    fetchAlertReplies(merchantId),
    fetchReviews(merchantId, allowedDealIds),
    fetchRefunds(merchantId, allowedDealIds),
  ])

  const sourceMap: Record<EvidenceSourceType, SourceResult> = {
    note: notesResult,
    alert_reply: alertsResult,
    review: reviewsResult,
    refund: refundsResult,
  }

  const failedSources = (Object.keys(sourceMap) as EvidenceSourceType[]).filter(
    (k) => sourceMap[k].status === 'failed',
  )

  const emptySamplingMeta: SamplingMeta = {
    totalFetched: 0,
    totalSelected: 0,
    bySource: {
      note: { fetched: 0, selected: 0, status: notesResult.status, error: notesResult.error },
      alert_reply: { fetched: 0, selected: 0, status: alertsResult.status, error: alertsResult.error },
      review: { fetched: 0, selected: 0, status: reviewsResult.status, error: reviewsResult.error },
      refund: { fetched: 0, selected: 0, status: refundsResult.status, error: refundsResult.error },
    },
  }

  if (failedSources.length > 0) {
    return { records: [], samplingMeta: emptySamplingMeta, incomplete: true, failedSources }
  }

  // Per-category limit: newest first
  const perCategorySelected: Record<EvidenceSourceType, EvidenceRecord[]> = {
    note: [],
    alert_reply: [],
    review: [],
    refund: [],
  }
  const allCandidates: EvidenceRecord[] = []

  for (const type of Object.keys(sourceMap) as EvidenceSourceType[]) {
    const sorted = [...sourceMap[type].records].sort(sortByTimestampDesc)
    const selected = sorted.slice(0, MAX_PER_CATEGORY)
    perCategorySelected[type] = selected
    allCandidates.push(...selected)
  }

  // Global sort: newest first with deterministic tie-breaker
  allCandidates.sort(sortByTimestampDesc)

  // Apply total and character limits (prefer complete records, skip oversized)
  let totalChars = 0
  const selected: EvidenceRecord[] = []
  for (const r of allCandidates) {
    if (selected.length >= MAX_TOTAL) break
    if (totalChars + r.text.length > MAX_CHARS) continue
    selected.push(r)
    totalChars += r.text.length
  }

  const totalFetched = (Object.values(sourceMap) as SourceResult[]).reduce(
    (sum, r) => sum + r.records.length,
    0,
  )

  const selectedByType = new Map<string, number>()
  for (const r of selected) {
    selectedByType.set(r.sourceType, (selectedByType.get(r.sourceType) ?? 0) + 1)
  }

  const samplingMeta: SamplingMeta = {
    totalFetched,
    totalSelected: selected.length,
    bySource: {
      note: { fetched: notesResult.records.length, selected: selectedByType.get('note') ?? 0, status: 'ok' },
      alert_reply: { fetched: alertsResult.records.length, selected: selectedByType.get('alert_reply') ?? 0, status: 'ok' },
      review: { fetched: reviewsResult.records.length, selected: selectedByType.get('review') ?? 0, status: 'ok' },
      refund: { fetched: refundsResult.records.length, selected: selectedByType.get('refund') ?? 0, status: 'ok' },
    },
  }

  return { records: selected, samplingMeta, incomplete: false, failedSources: [] }
}
