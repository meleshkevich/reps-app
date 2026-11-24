import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseAndValidateCsv,
  runMeasurement,
  computeGroupSummary,
  computePrimaryEffect,
  computeUncertainty,
  computeProjection,
  gbpStringToPence,
  HoldoutValidationError,
} from '../scripts/lib/holdout-measurement'
import type { MerchantRow, GroupSummary } from '../scripts/lib/holdout-measurement'
import { run, parseArgs } from '../scripts/measure-holdout'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve('scripts/fixtures/holdout.synthetic.csv')
const REP_HOURLY_PENCE = 2400 // £24/hr

function makeRow(overrides: Partial<MerchantRow> = {}): MerchantRow {
  return {
    merchant_id: 'M001',
    group: 'control',
    size_band: 'A',
    gp_30d_pence: 10000,
    rep_minutes: 30,
    additional_refund_loss_pence: 0,
    ...overrides,
  }
}

function mkSummary(netGps: number[], overrides: Partial<GroupSummary> = {}): GroupSummary {
  const mean = netGps.reduce((a, b) => a + b, 0) / netGps.length
  return {
    merchantCount: netGps.length,
    totalObservedGpPence: 0,
    totalRepMinutes: 0,
    totalRepCostPence: 0,
    totalAdditionalRefundLossPence: 0,
    totalNetGpPence: netGps.reduce((a, b) => a + b, 0),
    meanNetGpPence: mean,
    meanRepMinutes: 0,
    sizeBandCounts: { A: 0, B: 0, C: 0, D: 0 },
    merchantNetGpsPence: netGps,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Synthetic fixture reproduces expected group totals and primary effect
// ---------------------------------------------------------------------------

describe('synthetic fixture — group totals and primary effect', () => {
  const rows = parseAndValidateCsv(readFileSync(FIXTURE_PATH, 'utf-8'))
  const results = runMeasurement(rows, REP_HOURLY_PENCE, 1000)

  it('control: 4 merchants', () => expect(results.control.merchantCount).toBe(4))
  it('treatment: 4 merchants', () => expect(results.treatment.merchantCount).toBe(4))

  it('control observed GP = £280.00', () => expect(results.control.totalObservedGpPence).toBe(28000))
  it('treatment observed GP = £305.00', () => expect(results.treatment.totalObservedGpPence).toBe(30500))

  it('control rep cost = £36.00 (90 min at £24/hr)', () => expect(results.control.totalRepCostPence).toBe(3600))
  it('treatment rep cost = £16.00 (40 min at £24/hr)', () => expect(results.treatment.totalRepCostPence).toBe(1600))

  it('control net GP = £242.00', () => expect(results.control.totalNetGpPence).toBe(24200))
  it('treatment net GP = £288.00', () => expect(results.treatment.totalNetGpPence).toBe(28800))

  it('control mean net GP = £60.50', () => expect(results.control.meanNetGpPence).toBe(6050))
  it('treatment mean net GP = £72.00', () => expect(results.treatment.meanNetGpPence).toBe(7200))

  it('control mean rep minutes = 22.50', () => expect(results.control.meanRepMinutes).toBe(22.5))
  it('treatment mean rep minutes = 10.00', () => expect(results.treatment.meanRepMinutes).toBe(10))

  it('incremental net GP per merchant = £11.50', () => {
    expect(results.effect.incrementalNetGpPerMerchantPence).toBe(1150)
  })

  it('relative difference ≈ 19.01%', () => {
    expect(results.effect.relativePercentage).toBeCloseTo(19.008264, 2)
  })

  it('rep minutes saved per merchant = 12.50', () => {
    expect(results.effect.repMinutesSavedPerMerchant).toBe(12.5)
  })

  it('projected 30d impact = £11,500.00', () => {
    expect(results.projection?.projected30dImpactPence).toBe(1150000)
  })

  // CI verified independently from the formula — not hardcoded
  it('CI is computed correctly from the variance formula', () => {
    const controlNGs = [8800, 6800, 5200, 3400]
    const treatmentNGs = [10400, 8000, 6100, 4300]
    const tMean = treatmentNGs.reduce((a, b) => a + b, 0) / treatmentNGs.length
    const cMean = controlNGs.reduce((a, b) => a + b, 0) / controlNGs.length
    const effect = tMean - cMean
    const tVar = treatmentNGs.reduce((s, v) => s + (v - tMean) ** 2, 0) / (treatmentNGs.length - 1)
    const cVar = controlNGs.reduce((s, v) => s + (v - cMean) ** 2, 0) / (controlNGs.length - 1)
    const se = Math.sqrt(tVar / treatmentNGs.length + cVar / controlNGs.length)
    const expectedLower = effect - 1.96 * se
    const expectedUpper = effect + 1.96 * se

    expect(results.uncertainty.standardErrorPence).toBeCloseTo(se, 4)
    expect(results.uncertainty.ciLowerPence).toBeCloseTo(expectedLower, 4)
    expect(results.uncertainty.ciUpperPence).toBeCloseTo(expectedUpper, 4)
  })

  it('small-sample warning present', () => {
    expect(results.warnings.some(w => /small sample/i.test(w))).toBe(true)
  })

  it('CI-includes-zero warning present', () => {
    expect(results.warnings.some(w => /includes zero/i.test(w))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Rep cost calculation and penny rounding
// ---------------------------------------------------------------------------

describe('rep cost calculation and penny rounding', () => {
  it('15 min at £24/hr = 600p (£6.00)', () => {
    const summary = computeGroupSummary([makeRow({ rep_minutes: 15 })], 2400)
    expect(summary.totalRepCostPence).toBe(600)
  })

  it('10 min at £24/hr = round(400p) = 400p (exact)', () => {
    const summary = computeGroupSummary([makeRow({ rep_minutes: 10 })], 2400)
    expect(summary.totalRepCostPence).toBe(400)
  })

  it('10 min at £20/hr = round(333.33p) = 333p', () => {
    const summary = computeGroupSummary([makeRow({ rep_minutes: 10 })], 2000)
    expect(summary.totalRepCostPence).toBe(333)
  })

  it('rep cost is rounded per-merchant before aggregation', () => {
    // 10 min × 2 merchants at £20/hr: each rounds to 333p → total = 666p
    // (not: 10/60*2000*2 = 666.67 → round → 667p)
    const rows = [makeRow({ rep_minutes: 10 }), makeRow({ merchant_id: 'M002', rep_minutes: 10 })]
    const summary = computeGroupSummary(rows, 2000)
    expect(summary.totalRepCostPence).toBe(666)
  })
})

// ---------------------------------------------------------------------------
// 3. Unequal group sizes use group means, not totals
// ---------------------------------------------------------------------------

describe('unequal group sizes use means, not totals', () => {
  it('incremental effect is mean treatment − mean control, not totals', () => {
    const controlRows = [
      makeRow({ merchant_id: 'C1', gp_30d_pence: 10000, rep_minutes: 0 }),
      makeRow({ merchant_id: 'C2', gp_30d_pence: 10000, rep_minutes: 0 }),
    ]
    const treatmentRows = [
      makeRow({ merchant_id: 'T1', group: 'treatment', gp_30d_pence: 12000, rep_minutes: 0 }),
    ]
    const allRows = [...controlRows, ...treatmentRows]
    const results = runMeasurement(allRows, 0)
    // Control mean = 10000; treatment mean = 12000; effect = 2000 (£20)
    expect(results.effect.incrementalNetGpPerMerchantPence).toBe(2000)
    // NOT total treatment (12000) - total control (20000) = -8000
    expect(results.effect.incrementalNetGpPerMerchantPence).not.toBe(-8000)
  })
})

// ---------------------------------------------------------------------------
// 4. Refund adjustment subtracted exactly once
// ---------------------------------------------------------------------------

describe('refund adjustment subtracted exactly once', () => {
  it('net GP = observed GP − rep cost − refund adjustment', () => {
    const row = makeRow({ gp_30d_pence: 10000, rep_minutes: 60, additional_refund_loss_pence: 500 })
    const summary = computeGroupSummary([row], 2400) // repCost = 2400
    // 10000 - 2400 - 500 = 7100
    expect(summary.totalNetGpPence).toBe(7100)
    expect(summary.merchantNetGpsPence[0]).toBe(7100)
  })

  it('observed GP is NOT double-subtracted for refunds already included', () => {
    // If gp_30d_gbp is already net of refunds, additional_refund_loss_gbp = 0 means no extra deduction
    const row = makeRow({ gp_30d_pence: 10000, rep_minutes: 0, additional_refund_loss_pence: 0 })
    const summary = computeGroupSummary([row], 0)
    expect(summary.totalNetGpPence).toBe(10000)
  })
})

// ---------------------------------------------------------------------------
// 5. Negative observed GP is valid
// ---------------------------------------------------------------------------

describe('negative observed GP is valid', () => {
  it('accepts negative GP and produces negative net GP', () => {
    const rows = parseAndValidateCsv(
      'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,-50.00,0,0.00\n'
      + 'M2,treatment,B,-30.00,0,0.00\n',
    )
    const results = runMeasurement(rows, 0)
    expect(results.control.totalNetGpPence).toBe(-5000)
    expect(results.treatment.totalNetGpPence).toBe(-3000)
  })
})

// ---------------------------------------------------------------------------
// 6. Genuine zero outcomes are retained
// ---------------------------------------------------------------------------

describe('genuine zero outcomes are retained', () => {
  it('zero GP merchant is included in group and lowers the mean', () => {
    const rows = parseAndValidateCsv(
      'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.00,0,0.00\n'
      + 'M2,control,B,0.00,0,0.00\n'
      + 'M3,treatment,C,120.00,0,0.00\n',
    )
    const results = runMeasurement(rows, 0)
    expect(results.control.merchantCount).toBe(2)
    expect(results.control.meanNetGpPence).toBe(5000) // (10000 + 0) / 2
  })
})

// ---------------------------------------------------------------------------
// 7. Missing and malformed numeric values are rejected
// ---------------------------------------------------------------------------

describe('missing and malformed values are rejected', () => {
  it('rejects missing gp_30d_gbp', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,,30,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects non-numeric gp_30d_gbp', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,not_a_number,30,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects GP with more than 2 decimal places', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.001,30,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects missing rep_minutes', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.00,,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('error message is actionable (names the field and row)', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,bad_value,30,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    try {
      parseAndValidateCsv(csv)
      expect.fail('expected HoldoutValidationError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(HoldoutValidationError)
      const e = err as HoldoutValidationError
      expect(e.issues.some(i => i.includes('gp_30d_gbp'))).toBe(true)
      expect(e.issues.some(i => i.includes('Row 2'))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 8. Duplicate merchant IDs are rejected
// ---------------------------------------------------------------------------

describe('duplicate merchant IDs are rejected', () => {
  it('rejects duplicate IDs within same group', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.00,30,0.00\n'
      + 'M1,control,B,80.00,25,0.00\n'
      + 'M2,treatment,C,90.00,20,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects duplicate IDs across groups', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.00,30,0.00\n'
      + 'M1,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })
})

// ---------------------------------------------------------------------------
// 9. Invalid group and size band are rejected
// ---------------------------------------------------------------------------

describe('invalid group and size band', () => {
  it('rejects unknown group value', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,holdout,A,100.00,30,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects unknown size band', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,X,100.00,30,0.00\n'
      + 'M2,treatment,A,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })
})

// ---------------------------------------------------------------------------
// 10. Negative rep minutes and refund adjustments are rejected
// ---------------------------------------------------------------------------

describe('negative rep minutes and refund adjustments are rejected', () => {
  it('rejects negative rep_minutes', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.00,-5,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects negative additional_refund_loss_gbp', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.00,30,-1.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })
})

// ---------------------------------------------------------------------------
// 11. Missing experiment group is rejected
// ---------------------------------------------------------------------------

describe('missing experiment group', () => {
  it('rejects dataset with no control rows', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,treatment,A,100.00,30,0.00\n'
      + 'M2,treatment,B,80.00,25,0.00\n'
    try {
      parseAndValidateCsv(csv)
      expect.fail('expected HoldoutValidationError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(HoldoutValidationError)
      const e = err as HoldoutValidationError
      expect(e.issues.some(i => /control/i.test(i))).toBe(true)
    }
  })

  it('rejects dataset with no treatment rows', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,A,100.00,30,0.00\n'
      + 'M2,control,B,80.00,25,0.00\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects empty dataset', () => {
    const csv = 'merchant_id,group,size_band,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
    expect(() => parseAndValidateCsv(csv)).toThrow(HoldoutValidationError)
  })

  it('rejects missing required column', () => {
    const csv = 'merchant_id,group,gp_30d_gbp,rep_minutes,additional_refund_loss_gbp\n'
      + 'M1,control,100.00,30,0.00\n'
    try {
      parseAndValidateCsv(csv)
      expect.fail('expected HoldoutValidationError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(HoldoutValidationError)
      const e = err as HoldoutValidationError
      expect(e.issues.some(i => i.includes('size_band'))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 12. CI calculation and insufficient-sample handling
// ---------------------------------------------------------------------------

describe('confidence interval and insufficient-sample handling', () => {
  it('CI unavailable when treatment has fewer than 2 merchants', () => {
    const treatment = mkSummary([5000])
    const control = mkSummary([4000, 6000])
    const u = computeUncertainty(treatment, control, 1000)
    expect(u.available).toBe(false)
    expect(u.ciLowerPence).toBeNull()
    expect(u.ciUpperPence).toBeNull()
  })

  it('CI unavailable when control has fewer than 2 merchants', () => {
    const treatment = mkSummary([4000, 6000])
    const control = mkSummary([5000])
    const u = computeUncertainty(treatment, control, 1000)
    expect(u.available).toBe(false)
  })

  it('CI available with 2+ merchants in each group', () => {
    const treatment = mkSummary([7000, 8000])
    const control = mkSummary([5000, 6000])
    const u = computeUncertainty(treatment, control, 1500)
    expect(u.available).toBe(true)
    expect(u.standardErrorPence).not.toBeNull()
    expect(u.ciLowerPence).not.toBeNull()
    expect(u.ciUpperPence).not.toBeNull()
  })

  it('small-sample warning fires when group < 30', () => {
    const treatment = mkSummary([7000, 8000], { merchantCount: 2 })
    const control = mkSummary([5000, 6000], { merchantCount: 2 })
    const u = computeUncertainty(treatment, control, 500)
    expect(u.smallSampleWarning).toBe(true)
  })

  it('includesZero is true when lower < 0 and upper > 0', () => {
    const treatment = mkSummary([7200, 8000, 6100, 4300], { merchantCount: 4 })
    const control = mkSummary([8800, 6800, 5200, 3400], { merchantCount: 4 })
    const u = computeUncertainty(treatment, control, 1150)
    // With this small sample, CI includes zero
    expect(u.includesZero).toBe(true)
  })

  it('includesZero is false when both bounds have same sign', () => {
    // Large effect with small variance → CI clearly positive
    const netGps = Array.from({ length: 30 }, (_, i) => 10000 + i * 10)
    const treatment = mkSummary(netGps, { merchantCount: 30 })
    const control = mkSummary(netGps.map(v => v - 5000), { merchantCount: 30 })
    const effect = 5000
    const u = computeUncertainty(treatment, control, effect)
    if (u.available) {
      expect(u.ciLowerPence).toBeGreaterThan(0)
      expect(u.includesZero).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 13. Rollout projection and relative difference
// ---------------------------------------------------------------------------

describe('rollout projection and relative difference', () => {
  it('projection scales effect by eligible merchants', () => {
    const treatment = mkSummary([7200, 8000], { merchantCount: 2 })
    const control = mkSummary([6000, 6000], { merchantCount: 2 })
    const u = computeUncertainty(treatment, control, 700)
    const proj = computeProjection(700, u, 500)
    expect(proj.projected30dImpactPence).toBe(350000) // 700 * 500
    expect(proj.eligibleMerchants).toBe(500)
  })

  it('projected CI bounds are null when CI is unavailable', () => {
    const unavailable = {
      available: false,
      standardErrorPence: null,
      ciLowerPence: null,
      ciUpperPence: null,
      includesZero: false,
      smallSampleWarning: true,
    }
    const proj = computeProjection(500, unavailable, 100)
    expect(proj.projectedLowerPence).toBeNull()
    expect(proj.projectedUpperPence).toBeNull()
  })

  it('relative difference is null when control mean is exactly zero', () => {
    const treatment = mkSummary([1000], { merchantCount: 1, meanNetGpPence: 1000 })
    const control = mkSummary([0], { merchantCount: 1, meanNetGpPence: 0 })
    const effect = computePrimaryEffect(treatment, control)
    expect(effect.relativePercentage).toBeNull()
  })

  it('relative difference is null when control mean is negative', () => {
    const treatment = mkSummary([1000], { merchantCount: 1, meanNetGpPence: 1000 })
    const control = mkSummary([-500], { merchantCount: 1, meanNetGpPence: -500 })
    const effect = computePrimaryEffect(treatment, control)
    expect(effect.relativePercentage).toBeNull()
  })

  it('relative difference is computed when control mean is strictly positive', () => {
    const treatment = mkSummary([7200], { merchantCount: 1, meanNetGpPence: 7200 })
    const control = mkSummary([6050], { merchantCount: 1, meanNetGpPence: 6050 })
    const effect = computePrimaryEffect(treatment, control)
    expect(effect.relativePercentage).not.toBeNull()
    expect(effect.relativePercentage!).toBeCloseTo((1150 / 6050) * 100, 4)
  })

  it('gbpStringToPence converts correctly', () => {
    expect(gbpStringToPence('24')).toBe(2400)
    expect(gbpStringToPence('24.50')).toBe(2450)
    expect(gbpStringToPence('0.01')).toBe(1)
    expect(gbpStringToPence('-50.00')).toBe(-5000)
    expect(gbpStringToPence('0.00')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 14. Invalid CLI arguments and synthetic-mode labeling
// ---------------------------------------------------------------------------

describe('CLI argument validation and synthetic-mode labeling', () => {
  it('rejects missing --input', () => {
    const result = parseArgs(['--rep-hourly-cost', '24', '--mode', 'synthetic'])
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/--input/)
  })

  it('rejects missing --rep-hourly-cost', () => {
    const result = parseArgs(['--input', 'file.csv', '--mode', 'synthetic'])
    expect('error' in result).toBe(true)
  })

  it('rejects missing --mode', () => {
    const result = parseArgs(['--input', 'file.csv', '--rep-hourly-cost', '24'])
    expect('error' in result).toBe(true)
  })

  it('rejects invalid --mode', () => {
    const result = parseArgs(['--input', 'file.csv', '--rep-hourly-cost', '24', '--mode', 'fake'])
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/mode/)
  })

  it('rejects non-monetary --rep-hourly-cost', () => {
    const result = parseArgs(['--input', 'f.csv', '--rep-hourly-cost', 'abc', '--mode', 'synthetic'])
    expect('error' in result).toBe(true)
  })

  it('rejects non-positive --eligible-merchants', () => {
    const result = parseArgs(['--input', 'f.csv', '--rep-hourly-cost', '24', '--mode', 'synthetic', '--eligible-merchants', '0'])
    expect('error' in result).toBe(true)
  })

  it('rejects non-integer --eligible-merchants', () => {
    const result = parseArgs(['--input', 'f.csv', '--rep-hourly-cost', '24', '--mode', 'synthetic', '--eligible-merchants', '10.5'])
    expect('error' in result).toBe(true)
  })

  it('--help returns help text with exit code 0', () => {
    const result = run(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/Usage/)
  })

  it('invalid args return exit code 1', () => {
    const result = run(['--mode', 'synthetic'])
    expect(result.exitCode).toBe(1)
  })

  it('synthetic mode labels output as SYNTHETIC DATA', () => {
    const result = run([
      '--input', FIXTURE_PATH,
      '--rep-hourly-cost', '24',
      '--mode', 'synthetic',
      '--eligible-merchants', '1000',
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/SYNTHETIC/i)
    expect(result.stdout).toMatch(/demonstration/i)
  })

  it('synthetic mode shows £11.50 incremental GP per merchant', () => {
    const result = run([
      '--input', FIXTURE_PATH,
      '--rep-hourly-cost', '24',
      '--mode', 'synthetic',
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('£11.50')
  })
})
