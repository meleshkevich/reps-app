# Historical Findings: Restock Call GP Analysis

> **Status:** Documented from prior analysis. These numbers are observational differences, not causal impact estimates. Do not use them as financial engine uplift coefficients or as holdout experiment results.

---

## Source

Memo: *Restock calls: £11 GP per call* — Priya Nair.

---

## Analysis Window and Cohort

| Item | Value |
|---|---|
| Analysis window | October 2025 – September 2026 |
| Total sold-outs in cohort | 30,534 |
| Connected call group | 8,628 |
| Attempted call group | 5,675 |
| No logged rep activity group | 16,231 |

---

## Observed GP Differences

| Comparison | GP Difference |
|---|---|
| Called vs. left alone (called-weighted) | GBP 11.08 |
| Called vs. left alone (without active automation schedule) | GBP 14.67 |
| Called vs. left alone (with active automation schedule) | GBP 1.58 |

---

## Automation Schedule Exposure

Active automation schedule exposure:

| Group | Active schedule exposure |
|---|---|
| No logged rep activity | 25.1% |
| Called group | 5.6% |

Differential automation exposure was identified as a confound. The GBP 11.08 overall difference partly reflects group differences in automation status rather than the effect of a call.

---

## Matched Sold-Out Events

| Scope | Matched events |
|---|---|
| Within Priya's period | 5,690 |
| Across full export | 8,034 |

---

## Schedule Matching Methodology

Schedules were matched to sold-out events using:

- Join by `deal_id`.
- Inclusive schedule `start_date` / `end_date` boundaries.
- Blank `end_date` treated as ongoing (no end).
- Any single matching active schedule qualifies a sold-out event.
- Counts are of sold-out events, not individual schedule matches.

**Validation:** 17/17 manually inspected date-matching examples agreed with the implemented matching logic. Eleven initial checks were outside Priya's period; six additional checks were inside it. These are reported results from the previous analysis — no new tests were run to produce this document.

---

## Interpretation and Limitations

- **Observational, not causal.** GBP 11.08, GBP 14.67, and GBP 1.58 are observed differences between groups that differ in ways beyond whether a call was made. They do not establish that a call caused the GP difference.
- **Active schedule ≠ top-up occurred.** An active automation schedule does not prove a cap increase or restock actually happened during the measurement window.
- **No logged rep activity ≠ nothing happened.** Merchants in the no-logged-rep-activity group may have received calls or other contact not recorded in the CRM.
- **Residual confounding.** The called group and left-alone group differ in automation exposure and potentially other characteristics. The analysis adjusts for automation status but cannot adjust for all confounders.
- **GP accounting.** GP figures are net of refunds recognized within each sold-out event's 30-day measurement window. Refunds recognized after this window may not be reflected.
- **Data quality limitations.** CRM duplication, missing activity logs, incomplete outcome windows, and mismatched records remain known limitations.
- **Do not use as uplift coefficients.** None of GBP 11.08, GBP 14.67, or GBP 1.58 should be used as a causal lift coefficient in the financial engine (`utils/finance.ts`) or in any projection model.

---

## Document Status

Priya reported revising Section 2 and the caveats in the source memo. The revised document has not been independently verified by an external reviewer.

---

## Relationship to Holdout Experiment

The historical analysis provides motivation for the holdout experiment design but does not substitute for it. The holdout experiment (`docs/HOLDOUT_MEASUREMENT.md`) is designed to measure causal impact under controlled randomization. No actual holdout experiment has been run as of this writing.
