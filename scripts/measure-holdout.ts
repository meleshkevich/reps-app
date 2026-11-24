/**
 * Offline holdout measurement CLI.
 *
 * Usage:
 *   npm run measure:holdout -- --input <csv-path> --rep-hourly-cost <gbp> --mode <synthetic|real> [--eligible-merchants <n>]
 *
 * No network, API keys, LLM calls or database.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  parseAndValidateCsv,
  runMeasurement,
  gbpStringToPence,
  HoldoutValidationError,
} from './lib/holdout-measurement.js'
import type {
  HoldoutResults,
  GroupSummary,
  UncertaintyResult,
  ProjectionResult,
  SizeBand,
} from './lib/holdout-measurement.js'

// ---------------------------------------------------------------------------
// CLI argument types
// ---------------------------------------------------------------------------

export interface CliArgs {
  input: string
  repHourlyCostGbp: string
  mode: 'synthetic' | 'real'
  eligibleMerchants?: number
}

interface CliError {
  error: string
}

// ---------------------------------------------------------------------------
// Argument parsing and validation
// ---------------------------------------------------------------------------

const HELP = `
Usage:
  npm run measure:holdout -- --input <csv-path> --rep-hourly-cost <gbp> --mode <synthetic|real> [--eligible-merchants <n>]

Required:
  --input <path>             Path to the experiment CSV file
  --rep-hourly-cost <gbp>    Rep hourly cost in GBP (e.g. 24 or 24.50)
  --mode <synthetic|real>    synthetic: demonstration data; real: actual experiment data

Optional:
  --eligible-merchants <n>   Eligible rollout population for projection (positive integer)

  --help                     Show this help message
`.trim()

const GBP_RE = /^\d+(\.\d{1,2})?$/

export function parseArgs(argv: string[]): CliArgs | CliError {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { error: HELP }
  }

  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined
  }

  const input = get('--input')
  const repHourlyCostStr = get('--rep-hourly-cost')
  const modeStr = get('--mode')
  const eligibleStr = get('--eligible-merchants')

  const errors: string[] = []

  if (!input) errors.push('--input <csv-path> is required')
  if (!repHourlyCostStr) {
    errors.push('--rep-hourly-cost <gbp> is required')
  }
  else if (!GBP_RE.test(repHourlyCostStr)) {
    errors.push(`--rep-hourly-cost must be a non-negative GBP value with at most 2dp, got '${repHourlyCostStr}'`)
  }

  if (!modeStr) {
    errors.push('--mode <synthetic|real> is required')
  }
  else if (modeStr !== 'synthetic' && modeStr !== 'real') {
    errors.push(`--mode must be 'synthetic' or 'real', got '${modeStr}'`)
  }

  let eligibleMerchants: number | undefined
  if (eligibleStr !== undefined) {
    const n = Number(eligibleStr)
    if (!Number.isSafeInteger(n) || n <= 0) {
      errors.push(`--eligible-merchants must be a positive integer, got '${eligibleStr}'`)
    }
    else {
      eligibleMerchants = n
    }
  }

  if (errors.length > 0) {
    return { error: errors.join('\n') + '\n\nRun with --help for usage.' }
  }

  return {
    input: input!,
    repHourlyCostGbp: repHourlyCostStr!,
    mode: modeStr as 'synthetic' | 'real',
    eligibleMerchants,
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function fmtGbp(pence: number): string {
  const neg = pence < 0
  const abs = Math.abs(pence)
  const gbpStr = (abs / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return neg ? `-£${gbpStr}` : `£${gbpStr}`
}

function fmtEffect(pence: number): string {
  const sign = pence >= 0 ? '+' : ''
  return pence < 0 ? fmtGbp(pence) : `${sign}${fmtGbp(pence)}`
}

function fmtBands(counts: Record<SizeBand, number>): string {
  return (['A', 'B', 'C', 'D'] as SizeBand[])
    .filter(b => counts[b] > 0)
    .map(b => `${b}×${counts[b]}`)
    .join('  ')
}

function formatGroupSummary(label: string, g: GroupSummary): string {
  const lines: string[] = [
    `${label} (n = ${g.merchantCount})`,
    `  Observed GP:            ${fmtGbp(g.totalObservedGpPence)}`,
    `  Rep minutes:            ${g.totalRepMinutes.toFixed(0)}`,
    `  Rep cost:               ${fmtGbp(g.totalRepCostPence)}`,
    `  Refund adjustment:      ${fmtGbp(g.totalAdditionalRefundLossPence)}`,
    `  Net GP:                 ${fmtGbp(g.totalNetGpPence)}`,
    `  Mean net GP/merchant:   ${fmtGbp(Math.round(g.meanNetGpPence))}`,
    `  Mean rep minutes:       ${g.meanRepMinutes.toFixed(2)}`,
    `  Size bands:             ${fmtBands(g.sizeBandCounts)}`,
  ]
  return lines.join('\n')
}

function formatUncertainty(u: UncertaintyResult): string {
  if (!u.available) {
    return [
      'UNCERTAINTY',
      '  95% CI: unavailable (fewer than 2 merchants in a group)',
    ].join('\n')
  }
  const lines = [
    'UNCERTAINTY (approx. 95% CI, normal-based)',
    `  Standard error:  ${fmtGbp(Math.round(u.standardErrorPence!))}`,
    `  95% CI:          [${fmtEffect(u.ciLowerPence!)}, ${fmtEffect(u.ciUpperPence!)}]`,
  ]
  if (u.includesZero) {
    lines.push('  ⚠  CI includes zero — effect may not be reliable')
  }
  return lines.join('\n')
}

function formatProjection(p: ProjectionResult): string {
  const lines = [
    `ROLLOUT PROJECTION (${p.eligibleMerchants.toLocaleString()} eligible merchants, conditional)`,
    `  Point estimate:  ${fmtEffect(Math.round(p.projected30dImpactPence))} per 30 days`,
  ]
  if (p.projectedLowerPence !== null && p.projectedUpperPence !== null) {
    lines.push(
      `  Approx. range:   [${fmtEffect(Math.round(p.projectedLowerPence))}, ${fmtEffect(Math.round(p.projectedUpperPence))}]`,
    )
  }
  lines.push(
    `  Conditional on experiment effect generalizing to ${p.eligibleMerchants.toLocaleString()} eligible merchants`,
  )
  return lines.join('\n')
}

function formatResults(
  results: HoldoutResults,
  args: CliArgs,
): string {
  const { control, treatment, effect, uncertainty, projection, warnings } = results
  const isSynthetic = args.mode === 'synthetic'

  const sections: string[] = []

  sections.push('HOLDOUT MEASUREMENT')
  if (isSynthetic) {
    sections.push('⚠  SYNTHETIC DATA — demonstration only, not measured business impact\n')
  }
  else {
    sections.push(
      'Real-data mode. Interpretation depends on valid randomization,\n'
      + 'complete outcome collection, and consistent refund accounting.\n',
    )
  }

  sections.push(`Input:              ${args.input}`)
  sections.push(`Mode:               ${args.mode}`)
  sections.push(`Rep hourly cost:    £${args.repHourlyCostGbp}/hr`)
  if (args.eligibleMerchants !== undefined) {
    sections.push(`Eligible merchants: ${args.eligibleMerchants.toLocaleString()}`)
  }
  sections.push('')

  sections.push(formatGroupSummary('CONTROL', control))
  sections.push('')
  sections.push(formatGroupSummary('TREATMENT', treatment))
  sections.push('')

  const relPct = effect.relativePercentage !== null
    ? ` (${effect.relativePercentage >= 0 ? '+' : ''}${effect.relativePercentage.toFixed(2)}%)`
    : ' (relative difference: unavailable — control mean GP ≤ 0)'

  sections.push([
    'PRIMARY EFFECT (intention-to-treat, unadjusted)',
    `  Incremental net GP/merchant:  ${fmtEffect(Math.round(effect.incrementalNetGpPerMerchantPence))}${relPct}`,
    `  Rep minutes saved/merchant:   ${effect.repMinutesSavedPerMerchant.toFixed(2)} min`,
  ].join('\n'))
  sections.push('')

  sections.push(formatUncertainty(uncertainty))
  sections.push('')

  if (projection !== null) {
    sections.push(formatProjection(projection))
    sections.push('')
  }

  if (warnings.length > 0) {
    const allWarnings = isSynthetic
      ? ['SYNTHETIC DATA — results are demonstrations, not measured business impact', ...warnings]
      : warnings
    sections.push('WARNINGS')
    for (const w of allWarnings) {
      sections.push(`  ⚠  ${w}`)
    }
  }

  return sections.join('\n')
}

// ---------------------------------------------------------------------------
// run() — testable entry point
// ---------------------------------------------------------------------------

export interface RunResult {
  stdout: string
  exitCode: number
}

export function run(argv: string[]): RunResult {
  const parsed = parseArgs(argv)

  if ('error' in parsed) {
    const isHelp = argv.includes('--help') || argv.includes('-h')
    return { stdout: parsed.error + '\n', exitCode: isHelp ? 0 : 1 }
  }

  let csvContent: string
  try {
    csvContent = readFileSync(parsed.input, 'utf-8')
  }
  catch (err) {
    return {
      stdout: `Error: cannot read file '${parsed.input}': ${(err as Error).message}\n`,
      exitCode: 1,
    }
  }

  let rows
  try {
    rows = parseAndValidateCsv(csvContent)
  }
  catch (err) {
    if (err instanceof HoldoutValidationError) {
      return { stdout: err.message + '\n', exitCode: 1 }
    }
    return { stdout: `Error: ${(err as Error).message}\n`, exitCode: 1 }
  }

  const repHourlyPence = gbpStringToPence(parsed.repHourlyCostGbp)
  const results = runMeasurement(rows, repHourlyPence, parsed.eligibleMerchants)
  const output = formatResults(results, parsed)

  return { stdout: output + '\n', exitCode: 0 }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined
  && process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/')

if (isMain) {
  const { stdout, exitCode } = run(process.argv.slice(2))
  process.stdout.write(stdout)
  process.exit(exitCode)
}
