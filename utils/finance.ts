/**
 * Deterministic financial calculation engine.
 * Pure TypeScript — no Nuxt, API, or LLM dependencies.
 *
 * MONETARY AMOUNTS: all values are integer pence (GBP) unless noted.
 *
 * ROUNDING RULE:
 *   A single Math.round is applied at the end of each sub-expression that
 *   involves division or multiplication by a non-integer (e.g. attribution
 *   factor, minutes-to-hours conversion).  Integer additions and subtractions
 *   are exact and require no rounding.
 *
 * ESTIMATES ARE ADVISORY:
 *   All net GP figures are scenario-based projections. The incremental GP
 *   formula is a modeling assumption, not a validated causal relationship.
 *   Historical GP observations (e.g. sold-out-day averages) are inputs to
 *   the model; they are not proof of causal lift.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type AssumptionSource =
  | 'sandbox'
  | 'historical_estimate'
  | 'manual_assumption'

export type Recommendation = 'call' | 'dont_bother' | 'review'

export interface ValidationError {
  field: string
  message: string
}

/**
 * Inputs for a single scenario (low / base / high).
 * null = input is unavailable / not yet known.
 * 0   = input is known to be zero.
 */
export interface ScenarioInputs {
  // Incremental GP components
  expectedAdditionalVouchers: number | null
  gpPerAdditionalVoucherPence: number | null
  attributionFactor: number | null       // 0–1 inclusive
  capIncrease: number | null             // vouchers; additionalVouchers must not exceed this

  // Rep time cost components
  expectedCallMinutes: number | null
  repHourlyCostPence: number | null

  // Refund accounting (must be explicit — null is not "assume zero")
  additionalRefundAdjustmentPence: number | null
  refundAccountingBasis: string | null   // explains what GP-per-voucher already includes

  // Provenance metadata
  assumptionSource: AssumptionSource
  assumptionsVersion: string             // non-empty identifier
  warnings: string[]
}

export interface ScenarioResult {
  repTimeCostPence: number | null
  provisionalIncrementalGPPence: number | null
  netExpectedGPPence: number | null
  isComplete: boolean         // true iff all inputs present, valid, and GP computed
  missingInputs: string[]
  warnings: string[]
  errors: ValidationError[]
}

export interface FinancialScenarios {
  low: ScenarioInputs
  base: ScenarioInputs
  high: ScenarioInputs
}

export interface FinancialResults {
  low: ScenarioResult
  base: ScenarioResult
  high: ScenarioResult
}

export interface RecommendationContext {
  hasNoCallMark: boolean
  hasDoNotContact: boolean
  /**
   * true  — confirmed active schedule
   * false — confirmed no active schedule
   * null  — schedule status not yet fetched / unknown
   *
   * null and true both resolve to `review` (rule 2); only false passes through.
   */
  hasActiveAutoReplenish: boolean | null
  financialResults: FinancialResults
}

export interface RecommendationResult {
  recommendation: Recommendation
  reason: string
  /** Recommendations are advisory only — they do not trigger any automated action. */
  readonly isAdvisoryOnly: true
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_ASSUMPTION_SOURCES: readonly AssumptionSource[] = [
  'sandbox',
  'historical_estimate',
  'manual_assumption',
]

export function validateScenarioInputs(inputs: ScenarioInputs): ValidationError[] {
  const errors: ValidationError[] = []

  if (inputs.expectedAdditionalVouchers !== null && inputs.expectedAdditionalVouchers < 0)
    errors.push({ field: 'expectedAdditionalVouchers', message: 'Must not be negative' })

  if (inputs.gpPerAdditionalVoucherPence !== null && inputs.gpPerAdditionalVoucherPence < 0)
    errors.push({ field: 'gpPerAdditionalVoucherPence', message: 'Must not be negative' })

  if (inputs.attributionFactor !== null
    && (inputs.attributionFactor < 0 || inputs.attributionFactor > 1))
    errors.push({ field: 'attributionFactor', message: 'Must be between 0 and 1 inclusive' })

  if (inputs.expectedCallMinutes !== null && inputs.expectedCallMinutes < 0)
    errors.push({ field: 'expectedCallMinutes', message: 'Must not be negative' })

  if (inputs.repHourlyCostPence !== null && inputs.repHourlyCostPence < 0)
    errors.push({ field: 'repHourlyCostPence', message: 'Must not be negative' })

  if (inputs.additionalRefundAdjustmentPence !== null && inputs.additionalRefundAdjustmentPence < 0)
    errors.push({ field: 'additionalRefundAdjustmentPence', message: 'Must not be negative' })

  if (inputs.capIncrease !== null && inputs.capIncrease < 0)
    errors.push({ field: 'capIncrease', message: 'Must not be negative' })

  if (inputs.expectedAdditionalVouchers !== null
    && inputs.capIncrease !== null
    && inputs.expectedAdditionalVouchers > inputs.capIncrease)
    errors.push({
      field: 'expectedAdditionalVouchers',
      message: 'Must not exceed cap increase',
    })

  if (!(VALID_ASSUMPTION_SOURCES as readonly string[]).includes(inputs.assumptionSource))
    errors.push({
      field: 'assumptionSource',
      message: 'Must be sandbox, historical_estimate, or manual_assumption',
    })

  if (!inputs.assumptionsVersion || !inputs.assumptionsVersion.trim())
    errors.push({ field: 'assumptionsVersion', message: 'Must be a non-empty string' })

  return errors
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

/**
 * Rep time cost = (expectedCallMinutes / 60) × repHourlyCostPence
 * Rounding: single Math.round after the full expression.
 */
function calcRepTimeCost(
  minutes: number,
  hourlyCostPence: number,
): number {
  return Math.round((minutes / 60) * hourlyCostPence)
}

/**
 * Provisional incremental GP = expectedAdditionalVouchers
 *                              × gpPerAdditionalVoucherPence
 *                              × attributionFactor
 * Rounding: single Math.round after the full three-way product.
 *
 * NOTE: This formula is a modeling assumption. It does not prove causal lift.
 * Historical GP-per-voucher figures used as gpPerAdditionalVoucherPence are
 * observational averages, not measured incremental effects.
 */
function calcProvisionalGP(
  vouchers: number,
  gpPerVoucherPence: number,
  attributionFactor: number,
): number {
  return Math.round(vouchers * gpPerVoucherPence * attributionFactor)
}

export function calculateScenario(inputs: ScenarioInputs): ScenarioResult {
  const errors = validateScenarioInputs(inputs)

  if (errors.length > 0) {
    return {
      repTimeCostPence: null,
      provisionalIncrementalGPPence: null,
      netExpectedGPPence: null,
      isComplete: false,
      missingInputs: [],
      warnings: inputs.warnings,
      errors,
    }
  }

  const warnings = [...inputs.warnings]
  const missingInputs: string[] = []

  if (inputs.expectedAdditionalVouchers === null) missingInputs.push('expectedAdditionalVouchers')
  if (inputs.gpPerAdditionalVoucherPence === null) missingInputs.push('gpPerAdditionalVoucherPence')
  if (inputs.attributionFactor === null) missingInputs.push('attributionFactor')
  if (inputs.expectedCallMinutes === null) missingInputs.push('expectedCallMinutes')
  if (inputs.repHourlyCostPence === null) missingInputs.push('repHourlyCostPence')

  // Refund must be explicit — null is not "assume zero"
  if (inputs.additionalRefundAdjustmentPence === null) {
    missingInputs.push('additionalRefundAdjustmentPence')
    warnings.push(
      'Refund risk not estimated — additional refund losses unknown. '
      + 'Financial estimate is provisional.',
    )
  }
  if (inputs.refundAccountingBasis === null) {
    missingInputs.push('refundAccountingBasis')
    warnings.push('Refund accounting basis not specified. Cannot verify double-counting.')
  }

  // Rep time cost (computed when its own inputs are present)
  let repTimeCostPence: number | null = null
  if (inputs.expectedCallMinutes !== null && inputs.repHourlyCostPence !== null)
    repTimeCostPence = calcRepTimeCost(inputs.expectedCallMinutes, inputs.repHourlyCostPence)

  // Provisional incremental GP
  let provisionalIncrementalGPPence: number | null = null
  if (
    inputs.expectedAdditionalVouchers !== null
    && inputs.gpPerAdditionalVoucherPence !== null
    && inputs.attributionFactor !== null
  )
    provisionalIncrementalGPPence = calcProvisionalGP(
      inputs.expectedAdditionalVouchers,
      inputs.gpPerAdditionalVoucherPence,
      inputs.attributionFactor,
    )

  // Net expected GP (requires all three components)
  let netExpectedGPPence: number | null = null
  if (
    provisionalIncrementalGPPence !== null
    && repTimeCostPence !== null
    && inputs.additionalRefundAdjustmentPence !== null
  )
    netExpectedGPPence = provisionalIncrementalGPPence
      - repTimeCostPence
      - inputs.additionalRefundAdjustmentPence

  const isComplete = missingInputs.length === 0 && netExpectedGPPence !== null

  return {
    repTimeCostPence,
    provisionalIncrementalGPPence,
    netExpectedGPPence,
    isComplete,
    missingInputs,
    warnings,
    errors: [],
  }
}

export function calculateAllScenarios(scenarios: FinancialScenarios): FinancialResults {
  return {
    low: calculateScenario(scenarios.low),
    base: calculateScenario(scenarios.base),
    high: calculateScenario(scenarios.high),
  }
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

/**
 * Returns an advisory recommendation based on merchant context and financial
 * scenarios. Rules are applied in strict priority order.
 *
 * Recommendations are advisory only. They do not modify routing, automation,
 * or any external system.
 */
export function getRecommendation(ctx: RecommendationContext): RecommendationResult {
  // Rule 1: Existing no_call mark or do-not-contact restriction
  if (ctx.hasNoCallMark || ctx.hasDoNotContact) {
    return {
      recommendation: 'dont_bother',
      reason: ctx.hasNoCallMark
        ? 'Merchant has an active no_call mark'
        : 'Merchant is on the do-not-contact list',
      isAdvisoryOnly: true,
    }
  }

  // Rule 2: Active or unknown auto-replenish schedule.
  // null = status not fetched; treat as unknown → review.
  // Note: active auto-replenish does not prove a cap increase has already occurred.
  if (ctx.hasActiveAutoReplenish !== false) {
    return {
      recommendation: 'review',
      reason: ctx.hasActiveAutoReplenish === true
        ? 'Merchant has an active auto-replenish schedule — verify whether a cap increase has already occurred before calling'
        : 'Auto-replenish schedule status unknown — verify before calling',
      isAdvisoryOnly: true,
    }
  }

  const { low, base, high } = ctx.financialResults

  // Rule 3: Missing essential financial inputs
  if (!low.isComplete || !base.isComplete || !high.isComplete) {
    return {
      recommendation: 'review',
      reason: 'Financial estimate unavailable — required inputs missing',
      isAdvisoryOnly: true,
    }
  }

  const lowGP = low.netExpectedGPPence!
  const highGP = high.netExpectedGPPence!

  // Rule 4: All scenarios complete and low net GP > 0
  if (lowGP > 0) {
    return {
      recommendation: 'call',
      reason: 'Net expected GP is positive across all scenarios (advisory)',
      isAdvisoryOnly: true,
    }
  }

  // Rule 5: All scenarios complete and high net GP <= 0
  if (highGP <= 0) {
    return {
      recommendation: 'dont_bother',
      reason: 'Net expected GP is not positive even in the high scenario',
      isAdvisoryOnly: true,
    }
  }

  // Rule 6: Scenario range crosses zero
  return {
    recommendation: 'review',
    reason: 'Net GP range crosses zero — review case by case',
    isAdvisoryOnly: true,
  }
}
