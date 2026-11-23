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
