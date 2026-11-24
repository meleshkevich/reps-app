/**
 * Holdout measurement library.
 *
 * Pure functions — no file I/O, no network, no process.exit.
 * All monetary values are stored as integer pence (GBP) internally.
 * Statistical intermediates (means, variances) use full floating-point precision
 * and are rounded only at output formatting.
 *
 * ROUNDING CONVENTION:
 *   Each merchant's rep time cost is rounded to the nearest penny before
 *   aggregation: Math.round(repMinutes / 60 * repHourlyPence).
 *   Integer additions of pence values require no further rounding.
 */

import { parse as parseCsv } from 'csv-parse/sync'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const VALID_GROUPS = ['control', 'treatment'] as const
export type Group = (typeof VALID_GROUPS)[number]

export const VALID_SIZE_BANDS = ['A', 'B', 'C', 'D'] as const
export type SizeBand = (typeof VALID_SIZE_BANDS)[number]

export interface MerchantRow {
  merchant_id: string
  group: Group
  size_band: SizeBand
  /** Integer pence. Can be negative (observed loss). */
  gp_30d_pence: number
  /** Non-negative float. */
  rep_minutes: number
  /** Integer pence, non-negative. */
  additional_refund_loss_pence: number
}

export interface GroupSummary {
  merchantCount: number
  totalObservedGpPence: number
  totalRepMinutes: number
  totalRepCostPence: number
  totalAdditionalRefundLossPence: number
  totalNetGpPence: number
  /** Floating-point pence — full precision, rounded only at output. */
  meanNetGpPence: number
  meanRepMinutes: number
  sizeBandCounts: Record<SizeBand, number>
  /** Per-merchant net GP in pence — used for variance calculation. */
  merchantNetGpsPence: number[]
}

export interface PrimaryEffect {
  /** Floating-point pence. */
  incrementalNetGpPerMerchantPence: number
  repMinutesSavedPerMerchant: number
  /** null when control mean net GP is not strictly positive. */
  relativePercentage: number | null
}

export interface UncertaintyResult {
  standardErrorPence: number | null
  ciLowerPence: number | null
  ciUpperPence: number | null
  /** false when either group has fewer than 2 merchants. */
  available: boolean
  includesZero: boolean
  /** true when either group has fewer than 30 merchants (heuristic warning). */
  smallSampleWarning: boolean
}

export interface ProjectionResult {
  projected30dImpactPence: number
  projectedLowerPence: number | null
  projectedUpperPence: number | null
  eligibleMerchants: number
}

export interface HoldoutResults {
  control: GroupSummary
  treatment: GroupSummary
  effect: PrimaryEffect
  uncertainty: UncertaintyResult
  projection: ProjectionResult | null
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Validation error
// ---------------------------------------------------------------------------

export class HoldoutValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super('CSV validation failed:\n' + issues.map(i => `  - ${i}`).join('\n'))
    this.name = 'HoldoutValidationError'
  }
}

// ---------------------------------------------------------------------------
// GBP ↔ pence conversion
// ---------------------------------------------------------------------------

const GBP_PENCE_RE = /^-?\d+(\.\d{1,2})?$/

/**
 * Converts a GBP decimal string (up to 2dp) to integer pence.
 * Avoids floating-point multiplication by working with string parts.
 * Throws if the format is invalid.
 */
export function gbpStringToPence(str: string): number {
  const trimmed = (str ?? '').trim()
  if (!GBP_PENCE_RE.test(trimmed)) {
    throw new Error(`Invalid GBP value: '${trimmed}'`)
  }
  const negative = trimmed.startsWith('-')
  const abs = negative ? trimmed.slice(1) : trimmed
  const [intStr, decStr = ''] = abs.split('.')
  const decPadded = decStr.padEnd(2, '0')
  const pence = parseInt(intStr, 10) * 100 + parseInt(decPadded, 10)
  return negative ? -pence : pence
}

// ---------------------------------------------------------------------------
// CSV parsing and validation
// ---------------------------------------------------------------------------

const REQUIRED_COLUMNS = [
  'merchant_id',
  'group',
  'size_band',
  'gp_30d_gbp',
  'rep_minutes',
  'additional_refund_loss_gbp',
] as const

function parseRepMinutesField(raw: string, field: string, row: number): { value: number } | { error: string } {
  const v = (raw ?? '').trim()
  if (v === '') return { error: `Row ${row}: ${field} is missing` }
  const n = Number(v)
  if (!Number.isFinite(n) || Number.isNaN(n)) return { error: `Row ${row}: ${field} = '${v}' — must be a finite number` }
  if (n < 0) return { error: `Row ${row}: ${field} must be non-negative` }
  return { value: n }
}

function parseGbpField(
  raw: string,
  field: string,
  row: number,
  opts: { allowNegative: boolean },
): { pence: number } | { error: string } {
  const v = (raw ?? '').trim()
  if (v === '') return { error: `Row ${row}: ${field} is missing` }
  if (!GBP_PENCE_RE.test(v)) {
    return { error: `Row ${row}: ${field} = '${v}' — expected GBP decimal (max 2dp)` }
  }
  const pence = gbpStringToPence(v)
  if (!opts.allowNegative && pence < 0) {
    return { error: `Row ${row}: ${field} must be non-negative` }
  }
  return { pence }
}

export function parseAndValidateCsv(content: string): MerchantRow[] {
  const errors: string[] = []

  // Check for duplicate headers by inspecting the raw first line
  const firstLine = content.match(/^[^\r\n]*/)?.[0] ?? ''
  let rawHeaderCells: string[]
  try {
    rawHeaderCells = (parseCsv(firstLine, { columns: false }) as string[][])[0] ?? []
  }
  catch {
    rawHeaderCells = []
  }
  const trimmedHeaders = rawHeaderCells.map(h => h.trim())
  if (new Set(trimmedHeaders).size !== trimmedHeaders.length) {
    throw new HoldoutValidationError(['Duplicate column headers detected'])
  }

  // Parse all rows
  let rawRows: Array<Record<string, string>>
  try {
    rawRows = parseCsv(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>
  }
  catch (err) {
    throw new HoldoutValidationError([`CSV parse error: ${(err as Error).message}`])
  }

  if (rawRows.length === 0) {
    throw new HoldoutValidationError(['Dataset contains no data rows'])
  }

  // Check required columns
  const presentCols = Object.keys(rawRows[0])
  for (const col of REQUIRED_COLUMNS) {
    if (!presentCols.includes(col)) {
      errors.push(`Missing required column: '${col}'`)
    }
  }
  if (errors.length > 0) {
    throw new HoldoutValidationError(errors)
  }

  // Validate rows
  const seenIds = new Set<string>()
  const rows: MerchantRow[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]
    const rowNum = i + 2 // 1-indexed, header is row 1
    const rowErrors: string[] = []

    // merchant_id
    const merchantId = (raw.merchant_id ?? '').trim()
    if (!merchantId) {
      rowErrors.push(`Row ${rowNum}: merchant_id is empty`)
    }
    else if (seenIds.has(merchantId)) {
      rowErrors.push(`Row ${rowNum}: duplicate merchant_id '${merchantId}'`)
    }
    else {
      seenIds.add(merchantId)
    }

    // group
    const group = raw.group
    if (!(VALID_GROUPS as readonly string[]).includes(group)) {
      rowErrors.push(`Row ${rowNum}: group must be 'control' or 'treatment', got '${group}'`)
    }

    // size_band
    const sizeBand = raw.size_band
    if (!(VALID_SIZE_BANDS as readonly string[]).includes(sizeBand)) {
      rowErrors.push(`Row ${rowNum}: size_band must be A, B, C or D, got '${sizeBand}'`)
    }

    // gp_30d_gbp — can be negative
    const gpRes = parseGbpField(raw.gp_30d_gbp, 'gp_30d_gbp', rowNum, { allowNegative: true })
    if ('error' in gpRes) rowErrors.push(gpRes.error)

    // rep_minutes
    const repRes = parseRepMinutesField(raw.rep_minutes, 'rep_minutes', rowNum)
    if ('error' in repRes) rowErrors.push(repRes.error)

    // additional_refund_loss_gbp — non-negative
    const refundRes = parseGbpField(raw.additional_refund_loss_gbp, 'additional_refund_loss_gbp', rowNum, { allowNegative: false })
    if ('error' in refundRes) rowErrors.push(refundRes.error)

    errors.push(...rowErrors)

    if (rowErrors.length === 0) {
      rows.push({
        merchant_id: merchantId,
        group: group as Group,
        size_band: sizeBand as SizeBand,
        gp_30d_pence: (gpRes as { pence: number }).pence,
        rep_minutes: (repRes as { value: number }).value,
        additional_refund_loss_pence: (refundRes as { pence: number }).pence,
      })
    }
  }

  // Dataset-level checks
  const hasControl = rows.some(r => r.group === 'control')
  const hasTreatment = rows.some(r => r.group === 'treatment')
  if (!hasControl) errors.push("No 'control' group rows in dataset")
  if (!hasTreatment) errors.push("No 'treatment' group rows in dataset")

  if (errors.length > 0) {
    throw new HoldoutValidationError(errors)
  }

  return rows
}

// ---------------------------------------------------------------------------
// Financial calculations
// ---------------------------------------------------------------------------

export function computeGroupSummary(rows: MerchantRow[], repHourlyPence: number): GroupSummary {
  let totalObservedGpPence = 0
  let totalRepMinutes = 0
  let totalRepCostPence = 0
  let totalAdditionalRefundLossPence = 0
  let totalNetGpPence = 0
  const merchantNetGpsPence: number[] = []
  const sizeBandCounts: Record<SizeBand, number> = { A: 0, B: 0, C: 0, D: 0 }

  for (const row of rows) {
    const repCostPence = Math.round((row.rep_minutes / 60) * repHourlyPence)
    const netGpPence = row.gp_30d_pence - repCostPence - row.additional_refund_loss_pence

    totalObservedGpPence += row.gp_30d_pence
    totalRepMinutes += row.rep_minutes
    totalRepCostPence += repCostPence
    totalAdditionalRefundLossPence += row.additional_refund_loss_pence
    totalNetGpPence += netGpPence
    merchantNetGpsPence.push(netGpPence)
    sizeBandCounts[row.size_band]++
  }

  const merchantCount = rows.length
  return {
    merchantCount,
    totalObservedGpPence,
    totalRepMinutes,
    totalRepCostPence,
    totalAdditionalRefundLossPence,
    totalNetGpPence,
    meanNetGpPence: totalNetGpPence / merchantCount,
    meanRepMinutes: totalRepMinutes / merchantCount,
    sizeBandCounts,
    merchantNetGpsPence,
  }
}

export function computePrimaryEffect(treatment: GroupSummary, control: GroupSummary): PrimaryEffect {
  const incrementalNetGpPerMerchantPence = treatment.meanNetGpPence - control.meanNetGpPence
  const repMinutesSavedPerMerchant = control.meanRepMinutes - treatment.meanRepMinutes
  const relativePercentage = control.meanNetGpPence > 0
    ? (incrementalNetGpPerMerchantPence / control.meanNetGpPence) * 100
    : null

  return {
    incrementalNetGpPerMerchantPence,
    repMinutesSavedPerMerchant,
    relativePercentage,
  }
}

function sampleVariance(values: number[]): number {
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sumSqDev = values.reduce((sum, v) => sum + (v - mean) ** 2, 0)
  return sumSqDev / (n - 1)
}

export function computeUncertainty(
  treatment: GroupSummary,
  control: GroupSummary,
  effectPence: number,
): UncertaintyResult {
  const tCount = treatment.merchantCount
  const cCount = control.merchantCount
  const smallSampleWarning = tCount < 30 || cCount < 30

  if (tCount < 2 || cCount < 2) {
    return {
      standardErrorPence: null,
      ciLowerPence: null,
      ciUpperPence: null,
      available: false,
      includesZero: false,
      smallSampleWarning,
    }
  }

  const tVar = sampleVariance(treatment.merchantNetGpsPence)
  const cVar = sampleVariance(control.merchantNetGpsPence)
  const standardErrorPence = Math.sqrt(tVar / tCount + cVar / cCount)
  const ciLowerPence = effectPence - 1.96 * standardErrorPence
  const ciUpperPence = effectPence + 1.96 * standardErrorPence
  const includesZero = ciLowerPence <= 0 && ciUpperPence >= 0

  return {
    standardErrorPence,
    ciLowerPence,
    ciUpperPence,
    available: true,
    includesZero,
    smallSampleWarning,
  }
}

export function computeProjection(
  effectPence: number,
  uncertainty: UncertaintyResult,
  eligibleMerchants: number,
): ProjectionResult {
  return {
    projected30dImpactPence: effectPence * eligibleMerchants,
    projectedLowerPence: uncertainty.ciLowerPence !== null
      ? uncertainty.ciLowerPence * eligibleMerchants
      : null,
    projectedUpperPence: uncertainty.ciUpperPence !== null
      ? uncertainty.ciUpperPence * eligibleMerchants
      : null,
    eligibleMerchants,
  }
}

export function runMeasurement(
  rows: MerchantRow[],
  repHourlyPence: number,
  eligibleMerchants?: number,
): HoldoutResults {
  const controlRows = rows.filter(r => r.group === 'control')
  const treatmentRows = rows.filter(r => r.group === 'treatment')

  const control = computeGroupSummary(controlRows, repHourlyPence)
  const treatment = computeGroupSummary(treatmentRows, repHourlyPence)
  const effect = computePrimaryEffect(treatment, control)
  const uncertainty = computeUncertainty(treatment, control, effect.incrementalNetGpPerMerchantPence)

  const projection = eligibleMerchants !== undefined
    ? computeProjection(effect.incrementalNetGpPerMerchantPence, uncertainty, eligibleMerchants)
    : null

  const warnings: string[] = []
  if (uncertainty.smallSampleWarning) {
    warnings.push(
      `Small sample: control=${control.merchantCount}, treatment=${treatment.merchantCount} (fewer than 30 each)`,
    )
  }
  if (uncertainty.available && uncertainty.includesZero) {
    warnings.push('Confidence interval includes zero — effect may not be reliable')
  }

  return { control, treatment, effect, uncertainty, projection, warnings }
}
