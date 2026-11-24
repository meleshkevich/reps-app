# Project State

## T1 — Initialize Groupon Rep Tool

**Status:** Complete ✅

### Implemented

| File | Purpose |
|---|---|
| `package.json` | Nuxt 3, Tailwind, Vitest, ESLint, `vue-tsc`, `@types/node` + npm scripts |
| `nuxt.config.ts` | Nuxt config with Tailwind, ESLint, TypeScript check, Node types |
| `tsconfig.json` | Extends `.nuxt/tsconfig.json` |
| `tailwind.config.ts` | Content paths for purge, mobile-first by default |
| `app.vue` | Root: `<NuxtLayout><NuxtPage />` |
| `layouts/default.vue` | App shell: header with Sign out button |
| `pages/index.vue` | Placeholder home page (protected) |
| `utils/format.ts` | `formatCurrency(cents)` utility |
| `tests/format.test.ts` | Unit tests for `formatCurrency` (3 assertions) |
| `vitest.config.ts` | Vitest config with globals |
| `eslint.config.mjs` | ESLint config via `@nuxt/eslint` |
| `.env.example` | Placeholder env vars: `GROUPON_API_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET` |
| `.gitignore` | Excludes `.env`, `node_modules/`, `.nuxt/`, `.output/`, etc. |
| `README.md` | Setup, env vars, commands, deployment, project structure |

### Validation Results

| Command | Result |
|---|---|
| `npm install` | ✅ 999 packages |
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 3/3 passed |
| `npm run build` | ✅ 2.33 MB production output |

---

## T0 — Basic Admin Authentication

**Status:** Complete ✅

### Implemented

| File | Purpose |
|---|---|
| `server/utils/session.ts` | HMAC-SHA256 session token: `createSessionToken`, `verifySessionToken` |
| `server/utils/ratelimit.ts` | In-memory rate limiter: 5 attempts / 15 min per IP |
| `server/utils/auth.ts` | `validateCredentials`, `isSameOrigin` (same-origin check) |
| `server/middleware/auth.ts` | Server-side auth enforcement: 302→/login (pages), 401 JSON (APIs) |
| `server/api/auth/login.post.ts` | POST /api/auth/login — rate-limited, origin-checked, sets HttpOnly cookie |
| `server/api/auth/logout.post.ts` | POST /api/auth/logout — clears session cookie |
| `server/api/auth/me.get.ts` | GET /api/auth/me — returns 200 or 401 |
| `middleware/auth.ts` | Nuxt client-side route middleware — calls /api/auth/me, redirects to /login |
| `pages/login.vue` | Mobile-first login form at /login (layout: false) |
| `layouts/default.vue` | App shell with Sign out button |
| `app.vue` | Updated to use `<NuxtLayout>` |
| `tests/session.test.ts` | 10 tests: token creation, valid/tampered/expired/wrong-secret/format |
| `tests/ratelimit.test.ts` | 5 tests: allow, block at limit, independent keys, reset |
| `tests/credentials.test.ts` | 12 tests: valid creds, wrong password/email, same-origin CSRF, unauthorized simulation |

### Authentication Flow

1. **Login**: `POST /api/auth/login` validates email (`admin@groupon.com`) and password via `timingSafeEqual`. On success, sets `session` cookie (HttpOnly, SameSite=Lax, Secure in prod, 8h `maxAge`).
2. **Session token**: `base64url(json_payload).base64url(hmac_sha256)`. Payload contains `sub`, `iat`, `exp`. Signature is verified on every request with timing-safe comparison.
3. **SSR protection**: Nitro server middleware (`server/middleware/auth.ts`) runs before page rendering. Missing/invalid session → 302 to `/login` (pages) or 401 JSON (API routes).
4. **Client-side protection**: Nuxt route middleware (`middleware/auth.ts`) calls `/api/auth/me` on each client-side navigation; redirects to `/login` on 401.
5. **Logout**: `POST /api/auth/logout` deletes the session cookie.
6. **Rate limiting**: 5 login attempts per IP per 15-minute window (in-memory Map).
7. **Same-origin validation**: Login and logout check the `Origin` header against `Host` for cross-origin protection.

### Validation Results (T0)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors (required `@types/node`) |
| `npm run test` | ✅ 30/30 passed (4 test files) |
| `npm run build` | ✅ 2.36 MB production output |

### Known Limitations

- **Stateless logout**: The session cookie is cleared, but the token itself is not invalidated. If a token is stolen before logout, it remains valid until it expires (8h). No token revocation list.
- **In-memory rate limiter**: Resets on server restart; not shared across multiple server instances. Acceptable for single-process MVP.
- **Password length leakage**: `validateCredentials` returns `false` immediately when lengths differ, leaking password length via timing. Acceptable for single-admin MVP.
- **Client middleware vs SSR middleware**: The client-side middleware calls `/api/auth/me` on every navigation. For a production app this should be replaced with a Nuxt plugin + `useState` to avoid per-navigation API calls.
- **No HTTPS enforcement in dev**: The session cookie is not `Secure` in development (only in `NODE_ENV=production`).

### Deviations from Requirements

- None. All 10 requirements implemented.
- Added `@types/node` as a devDependency (required for TypeScript to recognize `node:crypto`, `Buffer`, `process.env`).

---

---

## Bugfix — Windows Dev Server Errors

**Status:** Complete ✅

### Root Cause

Dual Vite version conflict. `@nuxt/devtools` pulled in `vite 8.3.8` at the top level (peer dep `vite: >=6.0`), while `@nuxt/vite-builder` required `vite: ^7.3.6` (had its own nested `7.3.8`). When Nuxt started the dev server, the top-level `vite 8.x` and the builder's `vite 7.x` co-existed, causing:

1. **`app/assets/main.css outside of Vite serving allow list`** — path security checks behaving inconsistently between the two Vite instances.
2. **`Failed to resolve import "#app-manifest"`** — virtual module resolution failing under the mismatched Vite environments.

### Fix

Added npm `overrides` in `package.json` to pin Vite to `^7.3.6` globally, with a scoped exemption keeping vitest's internal Vite at `5.4.21` (vitest 2.x uses a Vite 5 internal `__vite_ssr_exportName__` that breaks on Vite 7):

```json
"overrides": {
  "vite": "^7.3.6",
  "vitest": {
    "vite": "5.4.21"
  }
}
```

**Result:** Top-level `vite 7.3.8` (used by Nuxt/devtools/tailwindcss), nested `vite 5.4.21` under vitest only.

### Validation Results (Bugfix)

| Command | Result |
|---|---|
| `npm install` | ✅ Lock file updated, vite 7.3.8 top-level, vite 5.4.21 nested in vitest |
| `npm run test` | ✅ 30/30 passed (4 test files) |
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| Dev server (`npm run dev`) | ✅ Reports Vite 7.3.8, `/login` returns 200, no allow-list errors |
| `npm run build` | ✅ Client + server + Nitro built successfully |

### Files Changed

- `package.json` — added `overrides` block

---

## Bugfix 2 — Stale CSS Path / `study-app` Reference

**Status:** Complete ✅

### Root Cause

The error `The request id "C:\Users\imeleskevic\projects\study-app\app\assets\main.css" is outside of Vite serving allow list` was produced by the **same dual-Vite version conflict** fixed in Bugfix 1.

Before the fix, `vite 8.x` (from `@nuxt/devtools`) and `vite 7.x` (from `@nuxt/vite-builder`) coexisted. With two Vite instances active, module IDs were resolved inconsistently: in some runs the absolute Windows path embedded in the HTML pointed to `study-app`'s files (a sibling Nuxt project on the same machine that uses `css: ['~/assets/main.css']`) instead of `reps-app`'s.

**Contributing factor**: `@nuxtjs/tailwindcss` had no project-local CSS file to resolve, so it fell back to `tailwindcss/tailwind.css` from `node_modules`. This produced a duplicate link tag with an absolute path, and under the dual-Vite conflict that path could resolve to the wrong project.

### Fix

Created `assets/css/tailwind.css` (the standard `@nuxtjs/tailwindcss` convention):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

This gives `@nuxtjs/tailwindcss` a project-owned CSS file to resolve:
- Module now reports `Using Tailwind CSS from ~/assets/css/tailwind.css` (not "Using default Tailwind CSS file")
- Both CSS link tags in dev HTML now point to `reps-app/assets/css/tailwind.css`
- CSS is always within `reps-app`'s Vite serving allow list
- No external `node_modules/tailwindcss/tailwind.css` fallback that could resolve to a wrong absolute path

### Validation Results (Bugfix 2)

| Command | Result |
|---|---|
| `npm run test` | ✅ 30/30 passed |
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors (shows "Using Tailwind CSS from ~/assets/css/tailwind.css") |
| Dev server (`npm run dev`) | ✅ Vite 7.3.8, `/login` returns 200, both CSS links reference `reps-app/assets/css/tailwind.css` |
| `npm run build` | ✅ 2.36 MB, clean build |

### Files Changed

- `assets/css/tailwind.css` — created with standard Tailwind directives

---

---

## T2 — Groupon Sandbox API Integration

**Status:** Complete ✅

### Files Created or Modified

| File | Purpose |
|---|---|
| `server/utils/sandbox.ts` | Typed sandbox API client: `sandboxFetch`, `getSoldoutsToday`, `getMerchants`, `getMerchantDeals`, `SandboxApiError` |
| `server/api/soldouts/today.get.ts` | `GET /api/soldouts/today` — proxies sandbox, auth-protected |
| `server/api/merchants/index.get.ts` | `GET /api/merchants` — proxies sandbox, auth-protected |
| `server/api/deals/index.get.ts` | `GET /api/deals?merchant_id=…` — proxies sandbox, auth-protected |
| `pages/index.vue` | Today's sold-outs page with loading/empty/error states |
| `tests/sandbox.test.ts` | 18 tests: auth header, success, pagination, HTTP errors, timeouts, missing key, endpoint auth |

### Confirmed API Response Schemas

Schemas verified against live sandbox responses:

**`TodaySoldOut`**: `sold_out_id`, `restock_task_id`, `deal_id`, `deal_name`, `merchant_id`, `merchant_name`, `category`, `region`, `city`, `size_band`, `rep_id`, `rep_name`, `do_not_contact` (bool), `cap`, `sold_out_at` (datetime), `team_time`, `world_day`, `posted_in_channel` (bool)

**`Merchant`**: `merchant_id`, `merchant_name`, `category`, `region`, `city`, `size_band`, `rep_id`, `rep_name` (nullable), `joined`, `do_not_contact` (bool)

**`Deal`**: `deal_id`, `merchant_id`, `sold_out_count`, `first_sold_out` (nullable), `last_sold_out` (nullable), `last_cap` (nullable)

**`SoldOutsTodayResponse`** wraps `TodaySoldOut[]` with `world_day`, `date`, `team_time`, `next_cursor`, `total`.

**Pagination**: `data`, `next_cursor` (string | null), `total` — all three endpoints verified.

### Architecture

- **API client** (`server/utils/sandbox.ts`): uses native Node.js `fetch` with 10 s `AbortController` timeout. Reads `GROUPON_API_KEY` from server env only. Throws typed `SandboxApiError(status, message)` on HTTP errors/timeouts. Never exposes the key or raw upstream error details.
- **Server endpoints**: protected by existing Nitro auth middleware (returns 401 for unauthenticated requests). Translate `SandboxApiError` to safe generic messages (`Upstream service error`, `Service unavailable`).
- **Frontend page**: uses `useFetch('/api/soldouts/today')` with SSR. Shows loading skeleton, empty state, error state, and data cards with merchant name, deal name, sold-out time, category, region/city, cap, rep name, DNC badge, posted-in-channel badge.

### Validation Results (T2)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 48/48 passed (5 test files, 18 new tests) |
| `npm run build` | ✅ 2.4 MB, all 3 new API routes in output |

### Manual Integration Test Results

| Test | Result |
|---|---|
| `GET /api/soldouts/today` unauthenticated | ✅ 401 |
| Login with correct credentials | ✅ 200 `{ ok: true }` |
| `GET /api/soldouts/today` authenticated | ✅ Returns live sandbox data (43 sold-outs, `world_day: d1`, `date: 2026-11-10`) |
| Sandbox `GET /merchants?limit=2` | ✅ 3000 total merchants, pagination cursor returned |
| Sandbox `GET /deals?merchant_id=M11395` | ✅ 2 deals returned with `sold_out_count`, `last_cap` |
| API key not exposed in browser response | ✅ Confirmed (no `gsk_` prefix in any response) |
| Logout | ✅ 200 `{ ok: true }` |
| `GET /api/soldouts/today` after logout | ✅ 401 |

### Known Limitations

- **Windows SSL cert revocation** (`CRYPT_E_NO_REVOCATION_CHECK`): Windows curl requires `-k` for the Railway HTTPS endpoint. The Node.js `fetch` in the actual server works fine as Node does not use the Windows CryptoAPI cert revocation check.
- **No auto-refresh**: The sold-outs page does not auto-refresh. The user must reload manually to see new sold-outs.
- **No pagination UI**: The page fetches the first page (default limit) only. No "load more" button yet.
- **Date on sandbox**: The sandbox uses a fixed demo date (`2026-11-10`) rather than today's real date — this is expected sandbox behaviour.
- **`team_time` on `TodaySoldOut` items**: Each sold-out item also has `team_time` and `world_day` fields (redundant with the response root fields) — interface matches the actual schema.

### Deviations from Requirements

- None. All 10 implementation requirements fulfilled.
- No additional npm dependencies added (uses native Node.js `fetch` and existing Nuxt/H3 utilities).

---

---

## T3 — Merchant Feedback & Marks

**Status:** Complete ✅

### Files Created or Modified

| File | Purpose |
|---|---|
| `server/utils/identity.ts` | Hard-coded admin identity: `ADMIN_IDENTITY` with `displayName: 'Groupon Admin'` |
| `server/utils/marks.ts` | `validateMarkReason()` — trims, checks non-empty, enforces 500-char limit |
| `server/utils/sandbox.ts` | Added `Mark`, `MarksResponse`, `DeleteMarkResponse` types; `sandboxMutate()`, `getMarks()`, `setMerchantMark()`, `deleteMerchantMark()` |
| `server/api/marks/index.get.ts` | `GET /api/marks` — proxies sandbox, auth-protected |
| `server/api/merchants/[id]/mark.put.ts` | `PUT /api/merchants/:id/mark` — validates reason, injects `marked_by` server-side |
| `server/api/merchants/[id]/mark.delete.ts` | `DELETE /api/merchants/:id/mark` — proxies sandbox, auth-protected |
| `layouts/default.vue` | Added "Groupon Admin" display name in header |
| `pages/index.vue` | Marks fetched alongside sold-outs; per-merchant mark state badge + add/edit/delete inline controls |
| `tests/marks.test.ts` | 25 tests covering marks CRUD, validation, auth protection, error handling, actor identity |

### Confirmed `marked_by` API Requirements

The `/marks` API's `marked_by` field is **free-form string** (no enumeration, no rep ID constraint). The actor identity is hard-coded server-side as `'Groupon Admin'` via `ADMIN_IDENTITY.displayName`. It is never accepted from the browser.

### Architecture

- **Admin identity** (`server/utils/identity.ts`): Single source of truth — hard-coded constant, resolved from server context. Session payload contains only `sub: 'admin'`; no identity claims are trusted from the browser.
- **Mark validation** (`server/utils/marks.ts`): `validateMarkReason` exported and unit-tested independently. Only `no_call` mark type is ever submitted.
- **`sandboxMutate`**: Parallel to `sandboxFetch` — handles PUT/DELETE with JSON body, same 10 s timeout/`AbortController` pattern and `SandboxApiError` propagation.
- **UI**: `useFetch('/api/marks')` fetched alongside sold-outs on SSR. `marksMap` computed Map keyed by `merchant_id`. Mark controls appear on first occurrence of each merchant in the sold-out list (tracked via `firstOccurrenceSoldOutIds`). Mark state badge (orange `no_call`) appears on all cards for a merchant, ensuring consistent display when multiple sold-outs share the same merchant.
- **Prevents duplicate submissions**: `markSubmitting[merchantId]` disables all action buttons while a request is in flight.

### Validation Results (T3)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 73/73 passed (6 test files, 25 new marks tests) |
| `npm run build` | ✅ 2.42 MB, `merchants/_id/mark.delete.mjs`, `merchants/_id/mark.put.mjs` in output |

### Manual Sandbox Integration Results

Test merchant used: `M11395` (had no prior mark — confirmed before testing).

| Step | Result |
|---|---|
| `GET /api/marks` unauthenticated | ✅ 401 |
| `PUT /api/merchants/M11395/mark` unauthenticated | ✅ 401 |
| Login | ✅ `{ ok: true }` |
| `GET /api/marks` authenticated | ✅ `{ data: [] }` (no prior marks) |
| Create no_call mark with reason | ✅ Returns `{ merchant_id, mark: 'no_call', marked_by: 'Groupon Admin', ... }` |
| `GET /api/marks` after create | ✅ Mark persisted for M11395 |
| Update reason (PUT again) | ✅ Returns updated reason, new `marked_at` |
| Delete mark | ✅ `{ removed: true, previous: {...} }` |
| `GET /api/marks` after delete | ✅ `{ data: [] }` — mark fully removed |
| Empty reason rejected | ✅ 400 `{ error: 'reason is required' }` |
| API key not in any response | ✅ Confirmed (no `gsk_` prefix in any response) |

Original mark state: `M11395` had no mark before testing. Mark state fully restored (deleted after test).

### Known Limitations

- **No pagination on marks**: `GET /marks` returns all marks in one response. If the admin creates many marks this could grow. No pagination documented in the API spec for this endpoint.
- **No optimistic UI**: Mark actions wait for the server round-trip + sandbox call before updating state. No optimistic update.
- **Mark controls on first occurrence only**: If the same merchant appears in the sold-out list multiple times, mark controls show only on the first card. All cards still show the mark state badge.
- **`sandboxMutate` sends no DELETE body**: The sandbox API accepts an optional reason body for DELETE (logged but not stored). We omit it to keep the implementation simple.

### Deviations from Requirements

- None. All requirements implemented.
- No additional npm dependencies (uses native Node.js `fetch` and existing Nuxt/H3 utilities).

---

---

## T3 UX — Minor Merchant Feedback Label Improvements

**Status:** Complete ✅

### Changes

- Badge: `no_call` → `Do not call`
- Existing mark details: removed `no_call` prefix, now shows `Reason: <reason>`
- Delete button: `Remove` → `Remove mark`
- Add button: `+ Add no_call mark` → `+ Mark as Do Not Call`
- Form header: `Add no_call mark` / `Edit no_call reason` → `Mark as Do Not Call` / `Edit reason`
- Textarea placeholder: `Reason for no_call...` → `Reason…`
- Added explanatory note in the form: *"This records merchant feedback. It does not automatically remove restock tasks."*

### Files Modified

| File | Change |
|---|---|
| `pages/index.vue` | Label wording, disclaimer note in form |

### Validation Results

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 73/73 passed |
| `npm run build` | ✅ 2.42 MB, clean build |

---

---

## T3 UX — Display Merchant Mark Author

**Status:** Complete ✅

### Change

Added `Marked by: <value>` line below the reason in the existing-mark section of the sold-outs dashboard. Uses the `marked_by` field already present on the `Mark` interface. Hidden via `v-if` when `marked_by` is empty. Styled with `text-xs text-gray-400` consistent with surrounding muted text.

### Files Modified

| File | Change |
|---|---|
| `pages/index.vue` | Added `Marked by:` line in existing-mark template block |

### Validation Results

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 73/73 passed |
| `npm run build` | ✅ 2.42 MB, clean build |

---

---

## T5 — Deterministic Financial Engine

**Status:** Complete ✅

### Files Created or Modified

| File | Purpose |
|---|---|
| `utils/finance.ts` | Pure financial calculation module — no Nuxt/API/LLM deps |
| `tests/finance.test.ts` | 48 tests: arithmetic, scenarios, missing inputs, validation, recommendation rules |
| `pages/index.vue` | Added `merchantRecommendation()` and "Estimate unavailable" display |

### Implemented Formulas

```
Rep time cost (pence) = round( expectedCallMinutes / 60 × repHourlyCostPence )

Provisional incremental GP (pence) = round( expectedAdditionalVouchers
                                           × gpPerAdditionalVoucherPence
                                           × attributionFactor )

Net expected GP (pence) = provisionalIncrementalGP
                        − repTimeCost
                        − additionalRefundAdjustmentPence
```

**Rounding rule:** A single `Math.round` is applied at the end of each sub-expression involving division or multiplication by a non-integer. Integer additions/subtractions are exact.

**Label:** Estimates are advisory scenario-based projections. The incremental GP formula is a modeling assumption, not a validated causal relationship. Historical GP averages are observational inputs, not measured lift.

### Recommendation Decision Logic (priority order)

| Rule | Condition | Outcome |
|---|---|---|
| 1 | `hasNoCallMark` or `hasDoNotContact` | `dont_bother` |
| 2 | `hasActiveAutoReplenish === true` or `=== null` (confirmed active or unknown) | `review` (verify schedule / status unknown) |
| 3 | Any scenario incomplete (missing inputs) | `review` (estimate unavailable) |
| 4 | All complete and `low.netGP > 0` | `call` |
| 5 | All complete and `high.netGP <= 0` | `dont_bother` |
| 6 | Otherwise (range crosses zero) | `review` |

All recommendations carry `isAdvisoryOnly: true`. They do not modify routing or automation state.

### Validation Results (T5)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 121/121 passed (7 test files, 48 new finance tests) |
| `npm run build` | ✅ Success |

### Available vs Missing Business Inputs

The sandbox provides historical financial and operational data including GP, vouchers sold, refunds, activity logs, and automation schedules. However, the currently implemented dashboard does not retrieve or derive all inputs required for a defensible incremental GP estimate. Historical GP averages or sold-out-day differences must not be used as causal lift coefficients.

| Input | Sandbox has data? | Retrieved by dashboard? |
|---|---|---|
| `do_not_contact` (DNC flag) | ✅ `TodaySoldOut.do_not_contact` | ✅ Yes |
| `no_call` mark | ✅ `GET /marks` | ✅ Yes |
| `expectedAdditionalVouchers` | ⚠️ Derivable from historical voucher data | ❌ Not fetched |
| `gpPerAdditionalVoucherPence` | ⚠️ Derivable from historical GP data | ❌ Not fetched |
| `attributionFactor` | ❌ Model assumption — not in sandbox | ❌ Not applicable |
| `expectedCallMinutes` | ❌ Rep experience — not in sandbox | ❌ Not applicable |
| `repHourlyCostPence` | ❌ Business config — not in sandbox | ❌ Not applicable |
| `additionalRefundAdjustmentPence` | ⚠️ Derivable from refund/activity data | ❌ Not fetched |
| `hasActiveAutoReplenish` | ⚠️ Automation schedules endpoint exists | ❌ Not fetched — passed as `null` |

**Consequence:** All merchants without DNC/no_call status display "Estimate unavailable — financial inputs not provided by sandbox." DNC/no_call merchants still receive `dont_bother` from rule 1. Unknown auto-replenish status (`null`) triggers rule 2 → `review` for all remaining merchants.

### Assumptions and Provenance Handling

- Each `ScenarioInputs` carries `assumptionSource` (`sandbox | historical_estimate | manual_assumption`), `assumptionsVersion` (non-empty string), and `warnings[]`.
- Both `additionalRefundAdjustmentPence` and `refundAccountingBasis` must be explicitly provided — `null` is not silently treated as zero.
- Missing refund inputs add a warning and mark the scenario incomplete (never silently zero-filled).
- `validateScenarioInputs` enforces non-negative monetary values, attribution factor bounds [0,1], cap increase constraint, and valid provenance metadata.

### Deliberate Scope Cuts / Known Limitations

- **No financial input forms**: required by T5 constraints. Inputs would need to come from a future configuration source.
- **Unknown `hasActiveAutoReplenish`**: automation schedule status is not fetched from the sandbox. Passed as `null` (unknown) → rule 2 fires as `review` with "status unknown" reason for all merchants without DNC/no_call restriction. Rule 1 still takes priority.
- **No net GP display**: all estimates are "unavailable" (dashboard shows the message rather than a £ figure).
- **Historical GP figures excluded**: Priya's £11.08, £14.67, £1.58 differences are not used anywhere in the engine per the explicit safeguard requirement.
- **Sandbox data not fully exploited**: Historical voucher counts, GP data, and refund history exist in the sandbox but are not retrieved. Derivation would require domain assumptions (e.g. attribution factor, call duration) not supplied by the sandbox itself.

---

---

## T5 — Final Corrections: Unknown Automation Status and Data Availability

**Status:** Complete ✅

### Changes

**1. Unknown auto-replenish status**

`RecommendationContext.hasActiveAutoReplenish` changed from `boolean` to `boolean | null`:
- `true` — confirmed active schedule → `review`
- `false` — confirmed inactive → continue financial evaluation
- `null` — status not fetched / unknown → `review` ("status unknown")

Rule 1 (restriction) still takes priority over all auto-replenish states.

Dashboard now passes `null` (was `false`) since the schedules API is not fetched.

**2. Data availability documentation**

PROJECT_STATE.md corrected: the sandbox provides historical financial and operational data (GP, vouchers, refunds, activities, automation schedules). The dashboard does not retrieve or derive these inputs — not because the sandbox lacks the data, but because derivation requires domain assumptions (attribution factor, call duration, rep cost) that the sandbox does not supply.

### Validation Results (T5 Corrections)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 124/124 passed (3 new tests: null auto-replenish, rule 1 overrides null, false bypasses rule 2) |
| `npm run build` | ✅ Success |

---

---

---

## T4 — Evidence-Based LLM Merchant Analysis

**Status:** Complete ✅

### Files Created or Modified

| File | Purpose |
|---|---|
| `utils/evidence.ts` | Pure TypeScript: `EvidenceRecord`, `EvidenceTokenMap`, `buildEvidenceTokenMap`, `validateAndResolveEvidence`, signal types |
| `server/utils/sandbox.ts` | Added `RepNote`, `AlertReply`, `Review`, `Refund` types and fetch helpers for all 4 evidence endpoints |
| `server/utils/evidenceCollector.ts` | Evidence collection from sandbox: normalization, ownership verification, deduplication, bounded selection |
| `server/utils/llmGateway.ts` | LLM gateway integration: single call, `tool_choice` for structured output, timeout, error handling |
| `server/api/analyze-merchant.post.ts` | POST `/api/analyze-merchant` — authenticated, full pipeline |
| `pages/index.vue` | Added "Analyze evidence" button, signal display, source-verified quotes, session-local rep feedback |
| `tests/evidence.test.ts` | 44 tests: token mapping, validation, fail-closed behavior |
| `docs/LLM_EVIDENCE.md` | Architecture, source-token pattern, examples, cost controls, limitations |

### Architecture

**Pipeline:** Dashboard action → authenticated POST `/api/analyze-merchant` → merchant deal retrieval → 4-source evidence collection → normalization and ownership verification → bounded selection → request-scoped token map → LLM call with native structured JSON output → text block parsing → deterministic validation → canonical resolution → signals with verified quotes → rep feedback.

**Source-token pattern:** Short tokens (`NOTE_1`, `ALERT_2`, `REVIEW_1`, `REFUND_1`) replace canonical IDs in model input. The model may generate invalid source tokens, but deterministic application validation prevents invalid references and unsupported quotes from being accepted as source-verified evidence. Every cited token is validated against the request-local map; every quote is verified as a case-sensitive substring of the original source text. Canonical metadata is resolved from the map, never from model output.

**Fail-closed:** Any validation failure rejects the entire analysis. Partially validated signals are never exposed.

### Evidence Sources

| Source | Sandbox endpoint | Schema |
|---|---|---|
| Rep notes | `GET /notes?merchant_id=...` | `note_id`, `merchant_id`, `rep_id`, `created_at`, `text` |
| Merchant alert replies | `GET /alert-replies?merchant_id=...` | `reply_id`, `merchant_id`, `received_at`, `text` |
| Customer reviews | `GET /reviews?merchant_id=...` | `review_id`, `merchant_id`, `deal_id`, `created_at`, `rating`, `text` |
| Refunds | `GET /refunds?merchant_id=...` | `refund_id`, `merchant_id`, `deal_id`, `created_at`, `amount_gbp`, `reason_text` |

### Sampling Limits

| Limit | Value |
|---|---|
| Max records per category | 10 |
| Max records total | 40 |
| Max evidence characters total | 20,000 |

### Supported Signal Types

`restock_intent`, `restock_refusal`, `callback_requested`, `capacity_risk`, `refund_risk`, `contact_restriction`, `automation_mentioned`, `other_relevant`

### Endpoint Result States

| Status | Meaning |
|---|---|
| `ok` | Validated signals with verified quotes |
| `no_evidence` | All sources retrieved but no usable records |
| `no_signals` | Valid LLM response with empty signals array |
| `incomplete_evidence` | One or more sources failed to retrieve (HTTP 206) |
| `llm_unavailable` | LLM call failed or timed out (HTTP 502) |
| `invalid_response` | Validation rejected the LLM output (HTTP 502) |

### LLM Configuration

| Setting | Value |
|---|---|
| Model | `claude-haiku-5-5` |
| Endpoint | `POST /llm/v1/messages` (gateway) |
| Max output tokens | 2,048 |
| Timeout | 30 seconds |
| Structured output | `output_config: { format: { type: 'json_schema', schema: {...} } }` (native structured JSON) |
| Retries | None — single call, fail-closed |

### Validation Results (T4 — original)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 234/234 passed (44 new evidence tests) |
| `npm run build` | ✅ 2.44 MB, `api/analyze-merchant.post.mjs` in output |

### Financial and Operational Boundaries Preserved

- Existing T3 no-call marks, DNC flags, and financial engine are unchanged.
- Positive LLM signals cannot override contact restrictions.
- `hasActiveAutoReplenish` remains `null` (unknown) for all merchants — automation mentions in evidence do not establish an active schedule.
- No LLM-generated financial estimates. Missing inputs continue to display "Estimate unavailable."
- Historical £11.08, £14.67, £1.58 figures not used anywhere.

### Gateway Smoke Test

Performed during T4 correction (2026-11-24). See `docs/LLM_EVIDENCE.md` for the full record.

**Merchant:** M10001 (Bright Skin & Spa) — 5 notes + 5 alert-replies  
**Model:** `claude-haiku-5-5` | **Stop reason:** `end_turn` | **Usage:** 943 input, 210 output tokens  
**Result:** 4 signals extracted (`capacity_risk`, `restock_refusal`, `contact_restriction`, `callback_requested`) — all with verified verbatim quotes

### Known Limitations and Deliberate Cuts

- Pagination limited to first page (up to 100 records per source, bounded to 10 per category).
- Merchants with more than 100 deals: deal ownership verification uses only the first 100 deals.
- Semantic correctness is not verified — quote verification establishes reference integrity only.
- Session-local rep feedback is not persisted.
- No multi-step reasoning, RAG, or automated repair.
- `nuxt typecheck` does not check `server/utils/evidenceCollector.ts` or `server/utils/llmGateway.ts` directly — Vitest covers them at build time.

---

---

## T4 — Gateway Compatibility Correction

**Status:** Complete ✅ (2026-11-24)

### Changes

**1. Gateway request rewritten** (`server/utils/llmGateway.ts`)

Replaced `tools: [SIGNAL_TOOL]` + `tool_choice: { type: 'tool', name: 'report_signals' }` (HTTP 400 on `claude-haiku-5-5`) with native structured JSON output:
- `thinking: { type: 'disabled' }`
- `output_config: { format: { type: 'json_schema', schema: { additionalProperties: false, ... } } }`
- Gateway-specific constraint: `additionalProperties: false` required on all schema object types
- Response: check `stop_reason === 'end_turn'`, find text block, `JSON.parse(block.text)`
- System prompt updated: removed "Call the report_signals tool" language, replaced with JSON output instruction

**2. Gateway tests added** (`tests/llmGateway.test.ts`)

27 mocked tests covering:
- Request shape: `output_config.format` present, `tools`/`tool_choice` absent, `thinking: disabled`, correct model, evidence tokens in messages, auth header, signal enum
- Successful parsing: valid response, empty signals, usage metadata
- Malformed/incomplete: `stop_reason !== end_turn`, missing text block, invalid JSON, empty text, truncated JSON
- HTTP failures: 400, 402 (budget), 429 (rate limit), 500
- Timeout: `AbortError` → `timed out` message
- No retries: `fetch` called exactly once on failure, network error, bad response
- Empty evidence guard: no `fetch` call when token map is empty

**3. Documentation corrected** (`docs/LLM_EVIDENCE.md`)

Replaced "The source-token pattern prevents fabricated source IDs" with the accurate claim: "The model may generate invalid source tokens, but deterministic application validation prevents invalid references and unsupported quotes from being accepted as source-verified evidence."

**4. Real gateway smoke test** (see Gateway Smoke Test section in T4 above)

Confirmed `output_config.format` approach works. Gateway also requires `additionalProperties: false` on all schema object types (discovered via actual 400 error; fixed before tests were written).

### Files Changed

| File | Change |
|---|---|
| `server/utils/llmGateway.ts` | Rewrote request to use `output_config.format`; updated system prompt; updated response parsing |
| `tests/llmGateway.test.ts` | Created — 27 mocked gateway tests |
| `docs/LLM_EVIDENCE.md` | Corrected terminology; added smoke test results; updated status |
| `PROJECT_STATE.md` | This update |

### Validation Results (T4 Correction)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 258/258 passed (234 existing + 24 new gateway tests) |
| `npm run build` | ✅ 2.44 MB, `api/analyze-merchant.post.mjs` in output |

---

---

## T6 — Offline Holdout Measurement CLI

**Status:** Complete ✅

### Files Created or Modified

| File | Purpose |
|---|---|
| `scripts/measure-holdout.ts` | CLI entry point: argument parsing, CSV loading, results formatting, process exit |
| `scripts/lib/holdout-measurement.ts` | Pure measurement library: CSV parsing, group statistics, net GP calculation, projections |
| `scripts/fixtures/holdout.synthetic.csv` | Synthetic demonstration dataset (not real experiment data) |
| `tests/holdout-measurement.test.ts` | 66 tests: parsing, validation, calculation, edge cases, CLI error handling |
| `docs/HOLDOUT_MEASUREMENT.md` | Experiment design, CSV contract, formulas, limitations |
| `docs/HISTORICAL_FINDINGS.md` | Source of £11.08 / £14.67 / £1.58 observational differences — not uplift coefficients |

### Architecture

**Offline-only CLI.** No network, API keys, LLM calls, or database access.

The library (`scripts/lib/holdout-measurement.ts`) is entirely pure functions with no side effects. The CLI (`scripts/measure-holdout.ts`) handles I/O: reads a CSV from disk, calls library functions, formats and prints results, then exits.

### Experiment Design

| Principle | Implementation |
|---|---|
| Randomization unit | Merchant |
| Analysis type | Intention-to-treat (all assigned merchants regardless of rep adherence) |
| Net GP formula | `netGP = observedGP − repTimeCost − refundAdjustment` |
| Projection | Conditional on eligible-merchants population (optional flag) |

### Usage

```bash
npm run measure:holdout -- \
  --input scripts/fixtures/holdout.synthetic.csv \
  --rep-hourly-cost 24 \
  --mode synthetic \
  --eligible-merchants 1000
```

**No actual experiment has been run.** The `--mode synthetic` flag gates output to make this explicit. Real results require a completed randomized experiment; use `--mode real` only with actual data.

### Historical Findings Boundary

The observational GP differences from Priya Nair's memo (£11.08 called vs. left alone; £14.67 without active automation; £1.58 with active automation) are documented in `docs/HISTORICAL_FINDINGS.md` as a historical reference. They are not used as causal uplift coefficients in the financial engine, the holdout CLI, or any calculation in this repository.

### Validation Results (T6)

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 258/258 passed (66 holdout tests) |
| `npm run build` | ✅ 2.44 MB, measurement scripts excluded from Nuxt build output (offline only) |

---

## Final Status — Assessment Submission (2026-11-24)

**All tasks complete: T0, T1, T2, T3, T4, T5, T6**

| Task | Description | Status |
|---|---|---|
| T1 | Initialize Nuxt 3 project, tooling, CI commands | ✅ Complete |
| T0 | Admin authentication (HMAC session, rate limit, same-origin) | ✅ Complete |
| T2 | Groupon sandbox API integration, sold-outs dashboard | ✅ Complete |
| T3 | Merchant feedback marks (no-call, server-side identity) | ✅ Complete |
| T4 | Evidence-based LLM analysis with deterministic source verification | ✅ Complete |
| T5 | Deterministic financial engine (scenario GP, recommendations) | ✅ Complete |
| T6 | Offline holdout measurement CLI | ✅ Complete |

**Final validation results:**

| Command | Result |
|---|---|
| `npm run lint` | ✅ No errors |
| `npm run typecheck` | ✅ No type errors |
| `npm run test` | ✅ 258/258 passed (10 test files, all offline) |
| `npm run build` | ✅ 2.44 MB production output |

**Security:**
- `.env` is in `.gitignore` and has never been committed to git history.
- `.env.example` contains only empty placeholders.
- No API keys, passwords, or session secrets appear in any committed file or git history.
- `marked_by` identity is hard-coded server-side — never accepted from the browser.
- API key read from `process.env` server-side — never sent to the browser.
- Raw merchant evidence, prompts, and credentials do not appear in logs.

**Routing and financial boundaries preserved:**
- Routing suppression is proposed but not implemented; no routing or automation settings changed.
- No routing approval has been obtained or claimed.
- Merchant `no_call` marks are advisory; they do not automatically suppress restock tasks.
- Historical GP differences are not used as causal uplift coefficients.
- No LLM-generated financial estimates; missing inputs display "Estimate unavailable."
- No new synthetic values are represented as actual Groupon impact.
