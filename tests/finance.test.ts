import { describe, it, expect } from 'vitest'
import {
  validateScenarioInputs,
  calculateScenario,
  calculateAllScenarios,
  getRecommendation,
  type ScenarioInputs,
  type ScenarioResult,
  type FinancialScenarios,
  type RecommendationContext,
} from '../utils/finance'

// ---- Fixtures ----

function makeInputs(overrides: Partial<ScenarioInputs> = {}): ScenarioInputs {
  return {
    expectedAdditionalVouchers: 10,
    gpPerAdditionalVoucherPence: 1000,   // £10.00
    attributionFactor: 0.8,
    capIncrease: 20,
    expectedCallMinutes: 15,
    repHourlyCostPence: 2000,            // £20.00/hr
    additionalRefundAdjustmentPence: 100, // £1.00
    refundAccountingBasis: '30-day GP already includes refunds within measurement window',
    assumptionSource: 'manual_assumption',
    assumptionsVersion: 'v1',
    warnings: [],
    ...overrides,
  }
}

/** Returns a fully-incomplete ScenarioResult (all inputs null). */
function emptyResult(): ScenarioResult {
  return {
    repTimeCostPence: null,
    provisionalIncrementalGPPence: null,
    netExpectedGPPence: null,
    isComplete: false,
    missingInputs: ['all financial inputs unavailable'],
    warnings: [],
    errors: [],
  }
}

function makeCtx(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    hasNoCallMark: false,
    hasDoNotContact: false,
    hasActiveAutoReplenish: false,
    financialResults: {
      low: emptyResult(),
      base: emptyResult(),
      high: emptyResult(),
    },
    ...overrides,
  }
}

/** Completed scenario result with a given net GP. */
function completeResult(netGP: number): ScenarioResult {
  return {
    repTimeCostPence: 0,
    provisionalIncrementalGPPence: netGP,
    netExpectedGPPence: netGP,
    isComplete: true,
    missingInputs: [],
    warnings: [],
    errors: [],
  }
}

// ---- validateScenarioInputs ----

describe('validateScenarioInputs', () => {
  it('accepts fully valid inputs', () => {
    expect(validateScenarioInputs(makeInputs())).toHaveLength(0)
  })

  it('accepts all-null inputs (unavailable, not invalid)', () => {
    expect(
      validateScenarioInputs(
        makeInputs({
          expectedAdditionalVouchers: null,
          gpPerAdditionalVoucherPence: null,
          attributionFactor: null,
          capIncrease: null,
          expectedCallMinutes: null,
          repHourlyCostPence: null,
          additionalRefundAdjustmentPence: null,
          refundAccountingBasis: null,
        }),
      ),
    ).toHaveLength(0)
  })

  it('rejects negative expectedAdditionalVouchers', () => {
    const errors = validateScenarioInputs(makeInputs({ expectedAdditionalVouchers: -1 }))
    expect(errors.some(e => e.field === 'expectedAdditionalVouchers')).toBe(true)
  })

  it('rejects negative gpPerAdditionalVoucherPence', () => {
    const errors = validateScenarioInputs(makeInputs({ gpPerAdditionalVoucherPence: -1 }))
    expect(errors.some(e => e.field === 'gpPerAdditionalVoucherPence')).toBe(true)
  })

  it('rejects attribution factor below 0', () => {
    const errors = validateScenarioInputs(makeInputs({ attributionFactor: -0.1 }))
    expect(errors.some(e => e.field === 'attributionFactor')).toBe(true)
  })

  it('rejects attribution factor above 1', () => {
    const errors = validateScenarioInputs(makeInputs({ attributionFactor: 1.01 }))
    expect(errors.some(e => e.field === 'attributionFactor')).toBe(true)
  })

  it('accepts attribution factor = 0 (edge)', () => {
    expect(validateScenarioInputs(makeInputs({ attributionFactor: 0 }))).toHaveLength(0)
  })

  it('accepts attribution factor = 1 (edge)', () => {
    expect(validateScenarioInputs(makeInputs({ attributionFactor: 1 }))).toHaveLength(0)
  })

  it('rejects negative expectedCallMinutes', () => {
    const errors = validateScenarioInputs(makeInputs({ expectedCallMinutes: -1 }))
    expect(errors.some(e => e.field === 'expectedCallMinutes')).toBe(true)
  })

  it('rejects negative repHourlyCostPence', () => {
    const errors = validateScenarioInputs(makeInputs({ repHourlyCostPence: -1 }))
    expect(errors.some(e => e.field === 'repHourlyCostPence')).toBe(true)
  })

  it('rejects negative additionalRefundAdjustmentPence', () => {
    const errors = validateScenarioInputs(makeInputs({ additionalRefundAdjustmentPence: -1 }))
    expect(errors.some(e => e.field === 'additionalRefundAdjustmentPence')).toBe(true)
  })

  it('rejects negative capIncrease', () => {
    const errors = validateScenarioInputs(makeInputs({ capIncrease: -1 }))
    expect(errors.some(e => e.field === 'capIncrease')).toBe(true)
  })

  it('rejects expectedAdditionalVouchers exceeding capIncrease', () => {
    const errors = validateScenarioInputs(
      makeInputs({ expectedAdditionalVouchers: 25, capIncrease: 20 }),
    )
    expect(errors.some(e => e.field === 'expectedAdditionalVouchers')).toBe(true)
  })

  it('accepts expectedAdditionalVouchers equal to capIncrease', () => {
    expect(
      validateScenarioInputs(makeInputs({ expectedAdditionalVouchers: 20, capIncrease: 20 })),
    ).toHaveLength(0)
  })

  it('rejects invalid assumptionSource', () => {
    const errors = validateScenarioInputs(
      makeInputs({ assumptionSource: 'made_up' as never }),
    )
    expect(errors.some(e => e.field === 'assumptionSource')).toBe(true)
  })

  it('rejects empty assumptionsVersion', () => {
    const errors = validateScenarioInputs(makeInputs({ assumptionsVersion: '' }))
    expect(errors.some(e => e.field === 'assumptionsVersion')).toBe(true)
  })

  it('rejects whitespace-only assumptionsVersion', () => {
    const errors = validateScenarioInputs(makeInputs({ assumptionsVersion: '   ' }))
    expect(errors.some(e => e.field === 'assumptionsVersion')).toBe(true)
  })
})

// ---- calculateScenario - arithmetic ----

describe('calculateScenario - financial arithmetic', () => {
  it('calculates rep time cost: 15 min at £20/hr = £5.00 (500p)', () => {
    // 15/60 × 2000 = 500
    const result = calculateScenario(makeInputs({ expectedCallMinutes: 15, repHourlyCostPence: 2000 }))
    expect(result.repTimeCostPence).toBe(500)
  })

  it('rounds rep time cost to nearest pence: 10 min at £20/hr = 333p', () => {
    // 10/60 × 2000 = 333.33… → round → 333
    const result = calculateScenario(makeInputs({ expectedCallMinutes: 10, repHourlyCostPence: 2000 }))
    expect(result.repTimeCostPence).toBe(333)
  })

  it('calculates provisional incremental GP: 10 vouchers × £10 × 0.8 = £80 (8000p)', () => {
    // 10 × 1000 × 0.8 = 8000
    const result = calculateScenario(
      makeInputs({
        expectedAdditionalVouchers: 10,
        gpPerAdditionalVoucherPence: 1000,
        attributionFactor: 0.8,
      }),
    )
    expect(result.provisionalIncrementalGPPence).toBe(8000)
  })

  it('rounds provisional GP with single Math.round: 10 × 333 × 0.333 ≈ 1110p', () => {
    // 10 × 333 × 0.333 = 1108.89 → round → 1109
    const result = calculateScenario(
      makeInputs({
        expectedAdditionalVouchers: 10,
        gpPerAdditionalVoucherPence: 333,
        attributionFactor: 0.333,
      }),
    )
    expect(result.provisionalIncrementalGPPence).toBe(1109)
  })

  it('calculates net expected GP: GP - rep cost - refund', () => {
    // provisionalGP = 10 × 1000 × 0.8 = 8000
    // repCost = 15/60 × 2000 = 500
    // refund = 100
    // net = 8000 - 500 - 100 = 7400
    const result = calculateScenario(makeInputs())
    expect(result.netExpectedGPPence).toBe(7400)
    expect(result.isComplete).toBe(true)
  })

  it('net GP can be negative', () => {
    const result = calculateScenario(
      makeInputs({
        expectedAdditionalVouchers: 1,
        gpPerAdditionalVoucherPence: 100,
        attributionFactor: 0.1,
        additionalRefundAdjustmentPence: 5000,
      }),
    )
    // provisional = 1 × 100 × 0.1 = 10; repCost = 500; refund = 5000; net = 10 - 500 - 5000 = -5490
    expect(result.netExpectedGPPence).toBe(-5490)
    expect(result.isComplete).toBe(true)
  })

  it('attribution factor 0 yields provisional GP of 0 (not null)', () => {
    const result = calculateScenario(makeInputs({ attributionFactor: 0 }))
    expect(result.provisionalIncrementalGPPence).toBe(0)
  })

  it('explicit 0 additionalRefundAdjustment is valid — not treated as missing', () => {
    const result = calculateScenario(makeInputs({ additionalRefundAdjustmentPence: 0 }))
    expect(result.isComplete).toBe(true)
    expect(result.missingInputs).not.toContain('additionalRefundAdjustmentPence')
  })
})

// ---- calculateScenario - missing vs zero ----

describe('calculateScenario - missing inputs vs genuine zero', () => {
  it('null expectedAdditionalVouchers → incomplete, provisionalGP null', () => {
    const result = calculateScenario(makeInputs({ expectedAdditionalVouchers: null }))
    expect(result.isComplete).toBe(false)
    expect(result.provisionalIncrementalGPPence).toBeNull()
    expect(result.missingInputs).toContain('expectedAdditionalVouchers')
  })

  it('0 expectedAdditionalVouchers → complete, provisionalGP = 0', () => {
    const result = calculateScenario(makeInputs({ expectedAdditionalVouchers: 0, capIncrease: 0 }))
    expect(result.isComplete).toBe(true)
    expect(result.provisionalIncrementalGPPence).toBe(0)
  })

  it('null additionalRefundAdjustmentPence → incomplete with warning', () => {
    const result = calculateScenario(makeInputs({ additionalRefundAdjustmentPence: null }))
    expect(result.isComplete).toBe(false)
    expect(result.missingInputs).toContain('additionalRefundAdjustmentPence')
    expect(result.warnings.some(w => w.includes('Refund risk'))).toBe(true)
  })

  it('null refundAccountingBasis → incomplete with warning', () => {
    const result = calculateScenario(makeInputs({ refundAccountingBasis: null }))
    expect(result.isComplete).toBe(false)
    expect(result.warnings.some(w => w.includes('accounting basis'))).toBe(true)
  })

  it('rep time cost computable even when GP inputs are missing', () => {
    const result = calculateScenario(
      makeInputs({ expectedAdditionalVouchers: null }),
    )
    expect(result.repTimeCostPence).toBe(500)
    expect(result.provisionalIncrementalGPPence).toBeNull()
  })

  it('invalid inputs return errors, not missingInputs', () => {
    const result = calculateScenario(makeInputs({ attributionFactor: 2 }))
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.isComplete).toBe(false)
  })
})

// ---- calculateAllScenarios ----

describe('calculateAllScenarios', () => {
  it('processes all three scenarios', () => {
    const low = makeInputs({ expectedAdditionalVouchers: 5 })
    const base = makeInputs({ expectedAdditionalVouchers: 10 })
    const high = makeInputs({ expectedAdditionalVouchers: 20, capIncrease: 20 })
    const scenarios: FinancialScenarios = { low, base, high }
    const results = calculateAllScenarios(scenarios)
    expect(results.low.isComplete).toBe(true)
    expect(results.base.isComplete).toBe(true)
    expect(results.high.isComplete).toBe(true)
    expect(results.low.netExpectedGPPence).toBeLessThan(results.base.netExpectedGPPence!)
    expect(results.base.netExpectedGPPence).toBeLessThan(results.high.netExpectedGPPence!)
  })
})

// ---- getRecommendation - restriction overrides ----

describe('getRecommendation - restriction overrides (rule 1)', () => {
  it('returns dont_bother for no_call mark', () => {
    const result = getRecommendation(makeCtx({ hasNoCallMark: true }))
    expect(result.recommendation).toBe('dont_bother')
    expect(result.reason).toMatch(/no_call/)
  })

  it('returns dont_bother for do_not_contact', () => {
    const result = getRecommendation(makeCtx({ hasDoNotContact: true }))
    expect(result.recommendation).toBe('dont_bother')
    expect(result.reason).toMatch(/do-not-contact/)
  })

  it('returns dont_bother when both no_call and DNC are set', () => {
    const result = getRecommendation(makeCtx({ hasNoCallMark: true, hasDoNotContact: true }))
    expect(result.recommendation).toBe('dont_bother')
  })

  it('rule 1 overrides auto-replenish (restriction takes priority)', () => {
    const result = getRecommendation(
      makeCtx({ hasNoCallMark: true, hasActiveAutoReplenish: true }),
    )
    expect(result.recommendation).toBe('dont_bother')
  })

  it('rule 1 overrides null auto-replenish (restriction takes priority over unknown)', () => {
    const result = getRecommendation(
      makeCtx({ hasNoCallMark: true, hasActiveAutoReplenish: null }),
    )
    expect(result.recommendation).toBe('dont_bother')
  })

  it('all results have isAdvisoryOnly: true', () => {
    expect(getRecommendation(makeCtx({ hasNoCallMark: true })).isAdvisoryOnly).toBe(true)
    expect(getRecommendation(makeCtx()).isAdvisoryOnly).toBe(true)
  })
})

// ---- getRecommendation - auto-replenish ----

describe('getRecommendation - active auto-replenish (rule 2)', () => {
  it('returns review for active auto-replenish', () => {
    const result = getRecommendation(makeCtx({ hasActiveAutoReplenish: true }))
    expect(result.recommendation).toBe('review')
    expect(result.reason).toMatch(/auto-replenish/)
  })

  it('auto-replenish reason clarifies cap increase not guaranteed', () => {
    const result = getRecommendation(makeCtx({ hasActiveAutoReplenish: true }))
    expect(result.reason).toMatch(/already occurred/)
  })

  it('returns review for unknown auto-replenish status (null)', () => {
    const result = getRecommendation(makeCtx({ hasActiveAutoReplenish: null }))
    expect(result.recommendation).toBe('review')
    expect(result.reason).toMatch(/unknown/)
  })

  it('false auto-replenish bypasses rule 2 — reason comes from rule 3 (missing inputs)', () => {
    const result = getRecommendation(makeCtx({ hasActiveAutoReplenish: false }))
    expect(result.recommendation).toBe('review')
    expect(result.reason).toMatch(/unavailable/)
  })
})

// ---- getRecommendation - missing financial inputs ----

describe('getRecommendation - missing financial inputs (rule 3)', () => {
  it('returns review when all scenarios incomplete', () => {
    const result = getRecommendation(makeCtx())
    expect(result.recommendation).toBe('review')
    expect(result.reason).toMatch(/unavailable/)
  })

  it('returns review even when only one scenario is incomplete', () => {
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(100),
          base: completeResult(200),
          high: emptyResult(), // incomplete
        },
      }),
    )
    expect(result.recommendation).toBe('review')
  })
})

// ---- getRecommendation - financial boundaries ----

describe('getRecommendation - financial boundaries', () => {
  it('rule 4: returns call when low GP > 0', () => {
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(1),    // > 0
          base: completeResult(500),
          high: completeResult(1000),
        },
      }),
    )
    expect(result.recommendation).toBe('call')
  })

  it('boundary: low GP = 1 → call', () => {
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(1),
          base: completeResult(1),
          high: completeResult(1),
        },
      }),
    )
    expect(result.recommendation).toBe('call')
  })

  it('boundary: low GP = 0 → not call (falls through to rule 5 or 6)', () => {
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(0),
          base: completeResult(0),
          high: completeResult(0),
        },
      }),
    )
    // low = 0, not > 0 → rule 4 misses; high = 0 ≤ 0 → rule 5 → dont_bother
    expect(result.recommendation).toBe('dont_bother')
  })

  it('rule 5: returns dont_bother when high GP <= 0', () => {
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(-500),
          base: completeResult(-200),
          high: completeResult(-1),
        },
      }),
    )
    expect(result.recommendation).toBe('dont_bother')
  })

  it('boundary: high GP = 0 exactly → dont_bother (rule 5)', () => {
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(-100),
          base: completeResult(-50),
          high: completeResult(0),
        },
      }),
    )
    expect(result.recommendation).toBe('dont_bother')
  })

  it('rule 6: range crosses zero → review', () => {
    // low < 0, high > 0 → neither rule 4 nor rule 5 matches
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(-100),
          base: completeResult(50),
          high: completeResult(300),
        },
      }),
    )
    expect(result.recommendation).toBe('review')
    expect(result.reason).toMatch(/zero/)
  })

  it('range crossing zero: low < 0, base > 0, high > 0 → review', () => {
    const result = getRecommendation(
      makeCtx({
        financialResults: {
          low: completeResult(-1),
          base: completeResult(100),
          high: completeResult(200),
        },
      }),
    )
    expect(result.recommendation).toBe('review')
  })
})
