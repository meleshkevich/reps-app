interface Entry {
  count: number
  resetAt: number
}

const store = new Map<string, Entry>()

export const RATE_LIMIT_MAX = 5
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

export function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 }
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 }
  }

  entry.count++
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count }
}

export function _resetStoreForTest() {
  store.clear()
}
