# Groupon Rep Tool

A mobile-first internal tool for Groupon sales reps, built with Nuxt 3 and Tailwind CSS.

## Stack

- **Nuxt 3** — full-stack Vue framework
- **TypeScript** — strict typing throughout
- **Tailwind CSS** — utility-first mobile-first styling
- **Vitest** — unit testing
- **ESLint** — linting via `@nuxt/eslint`

## Setup

```bash
npm install
```

Copy the environment file and fill in values:

```bash
cp .env.example .env
```

## Environment Variables

| Variable | Description |
|---|---|
| `GROUPON_API_KEY` | Groupon sandbox API key |
| `ADMIN_PASSWORD` | Plain-text admin password (hashed server-side) |
| `SESSION_SECRET` | Random string (min 32 chars) for signing session cookies |

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start development server at `http://localhost:3000` |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |
| `npm run test` | Run Vitest unit tests |

## Deployment

The app is Vercel-compatible. Connect the repository to a Vercel project and set the environment variables in the Vercel dashboard. No additional configuration is required.

## Holdout Measurement

An offline CLI calculates observed incremental net GP from a randomized merchant-level holdout experiment.

```bash
npm run measure:holdout -- \
  --input scripts/fixtures/holdout.synthetic.csv \
  --rep-hourly-cost 24 \
  --mode synthetic \
  --eligible-merchants 1000
```

| Argument | Description |
|---|---|
| `--input <path>` | Experiment CSV file |
| `--rep-hourly-cost <gbp>` | Rep hourly cost in GBP |
| `--mode <synthetic\|real>` | `synthetic` for demonstration, `real` for actual experiment data |
| `--eligible-merchants <n>` | Eligible rollout population for conditional projection (optional) |

See [docs/HOLDOUT_MEASUREMENT.md](docs/HOLDOUT_MEASUREMENT.md) for the experiment design, CSV contract, formulas, and limitations.

> No actual experiment has been run. Synthetic results are demonstrations only.

## Project Structure

```
reps-app/
├── pages/          # File-based routing
├── utils/          # Shared utility functions
├── tests/          # Unit tests
├── app.vue         # Root layout
├── nuxt.config.ts  # Nuxt configuration
└── tailwind.config.ts
```
