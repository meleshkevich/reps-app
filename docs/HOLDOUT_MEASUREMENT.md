# Holdout Measurement: CLI and Experiment Design

> **No actual experiment has been run.** This document describes the measurement design, CLI, and synthetic example. Real results require a completed randomized experiment.

---

## Experiment Objective

Measure the causal effect of the Groupon Rep Tool's decision-support recommendations on merchant net GP, relative to the existing restock workflow.

**Treatment:** Merchants whose reps receive decision-support recommendations from the tool (call / review / dont\_bother).

**Control:** Merchants whose reps follow the existing workflow without tool recommendations.

---

## Assignment Design

| Principle | Implementation |
|---|---|
| Randomization unit | Merchant |
| Eligibility | Defined before randomization |
| Allocation | Approximately 50/50, using a fixed seed |
| Balance | Within merchant size bands where feasible |
| Assignment persistence | Stored in an assignment manifest |
| Deal/sold-out assignment | All deals and sold-outs for a merchant follow the merchant's group |
| Control isolation | Control merchants do not receive treatment-specific recommendations or no-call marks |
| Analysis | All originally assigned merchants regardless of rep adherence (intention-to-treat) |

**Randomization execution** is outside the CLI's scope. The CLI consumes the resulting merchant-level experiment dataset.

---

## Contamination and Spillover

Reps may work merchants in both groups. This can transfer learned behaviors between groups, biasing the effect estimate toward zero (diluting the treatment effect). The assignment manifest and rep coverage data should be reviewed for spillover risk before interpreting results.

---

## Observation Window

A common fixed 30-day window for all merchants. Using a common window prevents bias from merchants with different enrollment dates or different exposure periods.

---

## CSV Input Schema

One row = one originally assigned merchant's aggregated outcomes over the 30-day window.

| Column | Type | Constraints |
|---|---|---|
| `merchant_id` | string | Non-empty, unique across all rows |
| `group` | string | `control` or `treatment` |
| `size_band` | string | `A`, `B`, `C`, or `D` |
| `gp_30d_gbp` | decimal | Signed, max 2dp; already net of refunds recognized in window |
| `rep_minutes` | number | Non-negative finite float |
| `additional_refund_loss_gbp` | decimal | Non-negative, max 2dp; refund losses not already in `gp_30d_gbp` |

Underlying financial transactions must be aggregated per merchant. Do not sum overlapping sold-out-level 30-day GP windows for the same merchant.

All originally assigned merchants must appear exactly once. Missing outcome data is not acceptable as a zero row.

The assignment manifest, eligibility criteria, enrollment dates, data extraction procedure, and refund accounting policy are retained separately and are not included in the CSV.

---

## Financial Formulas

```
repCostGbp = repMinutes / 60 × repHourlyCostGbp

netGpGbp = gp30dGbp − repCostGbp − additionalRefundLossGbp
```

**Integer pence arithmetic:** All monetary aggregation is performed in integer pence. Each merchant's rep cost is rounded to the nearest penny before aggregation. Statistical intermediates retain full floating-point precision until output formatting.

**Refund accounting note:**

- `gp_30d_gbp` is already net of refunds recognized within the 30-day window. Do not subtract those refunds again.
- `additional_refund_loss_gbp` represents GP losses not already included in `gp_30d_gbp`. An explicit zero is acceptable when the accounting policy excludes later refunds. A missing value is not acceptable.
- Rep time cost represents the economic value of rep capacity, not necessarily a direct cash payroll saving.

---

## CLI Commands

```bash
# Full example with synthetic fixture
npm run measure:holdout -- \
  --input scripts/fixtures/holdout.synthetic.csv \
  --rep-hourly-cost 24 \
  --mode synthetic \
  --eligible-merchants 1000

# Real data (after experiment)
npm run measure:holdout -- \
  --input /path/to/experiment-outcomes.csv \
  --rep-hourly-cost 24.00 \
  --mode real

# Help
npm run measure:holdout -- --help
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `--input <path>` | Yes | Path to the experiment CSV file |
| `--rep-hourly-cost <gbp>` | Yes | Rep hourly cost in GBP (e.g. `24` or `24.50`) |
| `--mode <synthetic\|real>` | Yes | `synthetic`: demonstration; `real`: actual experiment data |
| `--eligible-merchants <n>` | No | Eligible rollout population for projection |

---

## Synthetic Example

Fixture: `scripts/fixtures/holdout.synthetic.csv` — 8 merchants, 4 per group.

Command:

```bash
npm run measure:holdout -- --input scripts/fixtures/holdout.synthetic.csv --rep-hourly-cost 24 --mode synthetic --eligible-merchants 1000
```

Expected financial results:

| Metric | Control | Treatment |
|---|---:|---:|
| Merchants | 4 | 4 |
| Observed GP | £280.00 | £305.00 |
| Rep minutes | 90 | 40 |
| Rep cost (£24/hr) | £36.00 | £16.00 |
| Refund adjustment | £2.00 | £1.00 |
| Net GP | £242.00 | £288.00 |
| Mean net GP/merchant | £60.50 | £72.00 |
| Mean rep minutes | 22.50 | 10.00 |

Primary effect: **+£11.50 per merchant** (+19.01% relative difference).

Rep minutes saved: 12.50 per merchant.

Projected 30-day impact (1,000 eligible merchants): **+£11,500.00** (approximate range varies with CI).

Warnings generated: synthetic data, small sample, CI includes zero.

> All synthetic results are demonstrations. They are not measured Groupon business impact.

---

## Real Data Collection

After the experiment's 30-day window closes and data completeness checks are complete:

1. Extract merchant-level GP, rep activity minutes, and refund data for all originally assigned merchants from the data warehouse.
2. Reconcile against the assignment manifest to verify every assigned merchant has exactly one row.
3. Align the refund accounting policy: document what `gp_30d_gbp` already includes and what belongs in `additional_refund_loss_gbp`.
4. Run with `--mode real`.

The CLI does not independently verify randomization validity or assignment completeness. That reconciliation is a prerequisite to running the measurement.

---

## Statistical Uncertainty

The CLI reports an approximate normal-based 95% confidence interval:

```
standardError = sqrt(
  treatmentVariance / treatmentCount +
  controlVariance / controlCount
)

ciLower = effect − 1.96 × standardError
ciUpper = effect + 1.96 × standardError
```

Variance is the sample variance (denominator n − 1) of per-merchant net GP.

**Limitations of this interval:**

- Requires at least 2 merchants in each group.
- The normal approximation weakens with small samples (< 30 per group) and skewed GP distributions.
- Does not account for correlation between merchants served by the same rep.
- Not an exact small-sample interval.
- Does not prove causality.

---

## Rollout Projection

```
projected30dImpact = effect × eligibleMerchants
projectedCI        = [ciLower, ciUpper] × eligibleMerchants
```

**Limitations:**

- Conditional on the experiment effect generalizing to the eligible population.
- Does not automatically annualize.
- Not realized impact — no actual experiment has been run.
- Projection range reflects statistical uncertainty only, not uncertainty about whether the effect generalizes.

---

## Known Limitations

- CLI does not verify randomization validity or assignment completeness.
- Real input must be reconciled against the original assignment manifest before running.
- Rep-level spillover between groups can bias the effect estimate toward zero.
- Correlated merchant outcomes (same rep, same region) are not modeled.
- Small samples and skewed GP distributions weaken the normal-approximation interval.
- Merchant-level GP includes unrelated business changes unrelated to the tool, increasing outcome noise.
- Later refunds (outside the 30-day window) may not yet be observable and are excluded from `gp_30d_gbp`.
- No formal power calculation or sample-size analysis is included in this MVP.
- No automated assignment logic in the live application.
