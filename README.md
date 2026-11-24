# Groupon Rep Tool

A mobile-first internal decision-support tool for Groupon sales reps, built with Nuxt 3 / TypeScript / Tailwind CSS. It surfaces today's sold-out merchants, merchant feedback marks, scenario-based GP estimates, and evidence-based LLM-extracted signals — all behind server-side session authentication.

---

## Deployed Application

**URL:** `https://reps-app-ecru.vercel.app/` _(verify in the Vercel dashboard if the URL differs)_

**Login page:** `https://reps-app-ecru.vercel.app/login`  
**Email:** `admin@groupon.com`  
**Password:** provided in the submission cover email (not published here)

---

## Local Setup

```bash
npm install
cp .env.example .env   # then fill in values — see Environment Variables below
npm run dev            # starts at http://localhost:3000
```

### Environment Variables

| Variable | Description |
|---|---|
| `GROUPON_API_KEY` | Groupon sandbox API key (server-side only — never sent to the browser) |
| `ADMIN_PASSWORD` | Plain-text admin password; `timingSafeEqual` comparison server-side |
| `SESSION_SECRET` | Random string, minimum 32 characters, used to sign HMAC-SHA256 session tokens |

No value should appear in `.env.example`. The `.env` file is listed in `.gitignore` and is not committed.

---

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Development server at `http://localhost:3000` |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type checking via `nuxt typecheck` |
| `npm run test` | Vitest unit tests (258 tests, no network required) |
| `npm run measure:holdout -- --input <csv> --rep-hourly-cost <gbp> --mode synthetic` | Offline holdout measurement CLI |

---

## Architecture

### Stack

| Layer | Technology |
|---|---|
| Framework | Nuxt 3.21.11 / Nitro 2.13.6 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS (mobile-first) |
| Testing | Vitest 2.x |
| Runtime | Node.js v26.13.1 |
| Deployment | Vercel |

### Key Directories

```
reps-app/
├── pages/           # Nuxt file-based routing (index.vue — main dashboard)
├── server/
│   ├── api/         # Nitro API routes (auth, soldouts, merchants, marks, analyze-merchant)
│   ├── middleware/  # Server-side auth enforcement (runs before every request)
│   └── utils/       # Sandbox client, session, rate-limiter, evidence collector, LLM gateway
├── utils/           # Pure shared modules: finance.ts, evidence.ts, format.ts
├── scripts/         # Offline measurement CLI (measure-holdout.ts + lib/)
├── tests/           # Vitest unit tests (10 test files)
└── docs/            # Architecture and findings documentation
```

---

## Authentication (T0)

HMAC-SHA256 session tokens stored in an HttpOnly, SameSite=Lax cookie. Server middleware (`server/middleware/auth.ts`) runs before every request and enforces session validity. The session payload contains only `sub: 'admin'`; no identity claims are accepted from the browser. Rate-limited to 5 login attempts per IP per 15-minute window. See `server/utils/session.ts` and `server/utils/auth.ts`.

**Security notes:**
- `marked_by` identity is hard-coded server-side — never accepted from the browser.
- API key is read from `process.env.GROUPON_API_KEY` server-side — never sent to the browser.
- Raw merchant evidence, prompts, and credentials do not appear in logs.

---

## Sandbox API Integration (T2)

Proxies the Groupon sandbox via native Node.js `fetch` with a 10-second `AbortController` timeout. All credentials remain server-side. Endpoints: today's sold-outs, merchant list, merchant deals, rep notes, alert replies, reviews, refunds, marks. See `server/utils/sandbox.ts`.

---

## Merchant Marks — Do Not Call (T3)

Reps can record a `no_call` mark against a merchant with a free-text reason. The mark is advisory — it does not automatically suppress restock tasks or change routing. It is displayed as a badge and factored into the financial recommendation engine as a hard `dont_bother` blocker.

Actor identity (`marked_by: 'Groupon Admin'`) is injected server-side from `server/utils/identity.ts`, never from the browser.

---

## Deterministic Financial Engine (T5)

Pure TypeScript module (`utils/finance.ts`) with no network, Nuxt, or LLM dependencies. Calculates three scenario estimates (low / base / high) using:

```
Rep time cost         = round( expectedCallMinutes / 60 × repHourlyCostPence )
Provisional GP        = round( expectedAdditionalVouchers × gpPerVoucherPence × attributionFactor )
Net expected GP       = provisionalGP − repTimeCost − additionalRefundAdjustmentPence
```

**Current dashboard status:** All inputs except DNC flags and no-call marks are absent from the sandbox response — the financial engine therefore returns `Estimate unavailable` for every merchant. `hasActiveAutoReplenish` is passed as `null` (unknown), triggering a `review` recommendation for all merchants without a restriction. No historical GP differences (£11.08, £14.67, £1.58) are used as uplift coefficients anywhere in the engine.

**Routing and automation boundaries:**
- Recommendations are advisory only (`isAdvisoryOnly: true`).
- Routing suppression is proposed but not implemented — no routing settings were changed.
- No routing approval has been obtained or claimed.
- Merchant `no_call` marks do not automatically suppress restock tasks.
- `hasActiveAutoReplenish` remains `null` for all merchants — LLM automation signals do not establish an active schedule.

---

## Evidence-Based LLM Analysis (T4)

One LLM call per merchant analysis action. The pipeline is:

1. Fetch merchant deals, then all 4 evidence sources (notes, alert replies, reviews, refunds).
2. Normalize records, verify ownership, apply sampling limits (10 per category, 40 total, 20,000 characters).
3. Build a request-scoped token map: canonical IDs are replaced with short tokens (`NOTE_1`, `ALERT_2`, `REVIEW_1`, `REFUND_1`).
4. Call `claude-haiku-5-5` via the Groupon LLM gateway with native structured JSON output (`output_config.format`). Single call, no retries, 30-second timeout.
5. Validate every cited token against the request-local map, verify every quote as a case-sensitive substring of the original source text, resolve canonical metadata from the map (never from model output).
6. Fail-closed: any validation failure rejects the entire analysis.

**Source verification is reference integrity and quote authenticity, not factual or semantic verification.** The model may misclassify signal types, selectively quote, or miss signals. Human review is required before acting on signals.

**Cost controls:** one call per action, `max_tokens: 2048`, 30-second timeout, no retries, 402 → `llm_unavailable`, API key server-side only.

See [docs/LLM_EVIDENCE.md](docs/LLM_EVIDENCE.md) for the full architecture, schema, and gateway smoke test results.

---

## Offline Holdout Measurement (T6)

A standalone CLI that calculates observed net GP from a randomized merchant-level holdout experiment CSV. No network, API keys, LLM calls, or database access required.

```bash
npm run measure:holdout -- \
  --input scripts/fixtures/holdout.synthetic.csv \
  --rep-hourly-cost 24 \
  --mode synthetic \
  --eligible-merchants 1000
```

**No actual experiment has been run.** Synthetic results are demonstrations only.

See [docs/HOLDOUT_MEASUREMENT.md](docs/HOLDOUT_MEASUREMENT.md) for the experiment design, CSV contract, formulas, and limitations. See [docs/HISTORICAL_FINDINGS.md](docs/HISTORICAL_FINDINGS.md) for the source of the £11.08 / £14.67 / £1.58 observational GP differences — these are not used as causal uplift coefficients.

---

## Tests

All tests run offline — no live sandbox API credentials, LLM budget, or external network access required.

```bash
npm run test
```

258 tests across 10 files. Breakdown:

| File | Tests |
|---|---|
| `tests/session.test.ts` | 10 |
| `tests/ratelimit.test.ts` | 5 |
| `tests/credentials.test.ts` | 12 |
| `tests/format.test.ts` | 3 |
| `tests/sandbox.test.ts` | 18 |
| `tests/marks.test.ts` | 25 |
| `tests/finance.test.ts` | 51 |
| `tests/holdout-measurement.test.ts` | 66 |
| `tests/evidence.test.ts` | 44 |
| `tests/llmGateway.test.ts` | 24 |

---

## Known Limitations and Deliberate Cuts

| Item | Detail |
|---|---|
| Financial estimates unavailable | All sandbox-derived inputs missing — displays "Estimate unavailable" for all merchants |
| Routing suppression not implemented | Marks are advisory; no routing or automation settings changed |
| No causal impact validation | Historical GP differences are observational; no holdout experiment has run |
| Automation schedule not fetched | `hasActiveAutoReplenish` is `null` for all merchants → `review` recommendation |
| Session-local rep feedback only | LLM analysis confirm/flag actions not persisted to sandbox |
| No evidence pagination | First page only (up to 10 records per evidence category) |
| No real-time push | Sold-outs page requires manual reload; no auto-refresh |
| Stateless logout | Session cookie is cleared but token is not revoked until expiry (8 h) |
| In-memory rate limiter | Resets on server restart; not shared across instances |
| Semantic correctness not verified | Quote verification checks reference integrity only — not meaning |

---

## Documentation

| Document | Contents |
|---|---|
| [docs/LLM_EVIDENCE.md](docs/LLM_EVIDENCE.md) | LLM evidence architecture, source-token pattern, validation, cost controls, smoke test |
| [docs/HOLDOUT_MEASUREMENT.md](docs/HOLDOUT_MEASUREMENT.md) | Holdout experiment design, CSV contract, measurement formulas |
| [docs/HISTORICAL_FINDINGS.md](docs/HISTORICAL_FINDINGS.md) | Observational GP differences from prior analysis — not uplift coefficients |
| [PROJECT_STATE.md](PROJECT_STATE.md) | Detailed per-task implementation notes, validation results, known limitations |

## Groupon AI Builder — Final Time Log

| Activity | Time |
|---|---:|
| Brief, API, data pack, stakeholder questions | 30 min |
| Stakeholder responses | 10 min |
| Focused historical analysis | 15 min |
| Schedule-join audit | 10 min |
| Strategy/analysis follow-up | 5 min |
| T1–T2 — Initial Development | 20 min |
| T3 — Merchant Feedback | 25 min |
| T5 — GP Estimation & Recommendation Engine | 20 min |
| T6 — Holdout Measurement | 15 min |
| T4 — LLM Evidence Analysis | 20 min |
| Submission materials and delivery | 10 min |
| **Total active work** | **180 min (3 hours)** |