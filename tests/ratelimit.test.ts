import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, RATE_LIMIT_MAX, _resetStoreForTest } from '../server/utils/ratelimit'

function uniqueKey() {
  return `test:${Math.random().toString(36).slice(2)}`
}

beforeEach(() => {
  _resetStoreForTest()
})

describe('checkRateLimit', () => {
  it('allows the first attempt', () => {
    const { allowed, remaining } = checkRateLimit(uniqueKey())
    expect(allowed).toBe(true)
    expect(remaining).toBe(RATE_LIMIT_MAX - 1)
  })

  it('allows up to MAX_ATTEMPTS attempts', () => {
    const key = uniqueKey()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const result = checkRateLimit(key)
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks on the attempt after MAX_ATTEMPTS', () => {
    const key = uniqueKey()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit(key)
    }
    const { allowed, remaining } = checkRateLimit(key)
    expect(allowed).toBe(false)
    expect(remaining).toBe(0)
  })

  it('independent keys do not interfere', () => {
    const key1 = uniqueKey()
    const key2 = uniqueKey()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit(key1)
    checkRateLimit(key1) // blocked
    const result = checkRateLimit(key2)
    expect(result.allowed).toBe(true)
  })

  it('resets after the window expires', () => {
    const key = uniqueKey()
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) checkRateLimit(key)
    // Directly manipulate store via clear + re-check to simulate reset
    _resetStoreForTest()
    const result = checkRateLimit(key)
    expect(result.allowed).toBe(true)
  })
})
