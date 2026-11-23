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

## Next Task

**T2** — pending explicit approval.
