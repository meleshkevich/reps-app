import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { validateCredentials, isSameOrigin, ADMIN_EMAIL } from '../server/utils/auth'

const ADMIN_PASSWORD = 'correcthorsebatterystaple123'

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSWORD', ADMIN_PASSWORD)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('validateCredentials', () => {
  it('accepts correct email and password', () => {
    expect(validateCredentials(ADMIN_EMAIL, ADMIN_PASSWORD)).toBe(true)
  })

  it('rejects wrong password', () => {
    expect(validateCredentials(ADMIN_EMAIL, 'wrongpassword1234567890')).toBe(false)
  })

  it('rejects wrong email', () => {
    expect(validateCredentials('other@groupon.com', ADMIN_PASSWORD)).toBe(false)
  })

  it('rejects empty password', () => {
    expect(validateCredentials(ADMIN_EMAIL, '')).toBe(false)
  })

  it('rejects when ADMIN_PASSWORD is not set', () => {
    vi.unstubAllEnvs()
    vi.stubEnv('ADMIN_PASSWORD', '')
    expect(validateCredentials(ADMIN_EMAIL, ADMIN_PASSWORD)).toBe(false)
  })
})

describe('isSameOrigin', () => {
  it('allows when Origin matches Host', () => {
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000')).toBe(true)
  })

  it('allows when no Origin header is present', () => {
    expect(isSameOrigin(undefined, 'localhost:3000')).toBe(true)
  })

  it('blocks cross-origin requests', () => {
    expect(isSameOrigin('https://evil.example.com', 'localhost:3000')).toBe(false)
  })

  it('blocks when Origin is malformed', () => {
    expect(isSameOrigin('not-a-url', 'localhost:3000')).toBe(false)
  })

  it('blocks when no Host header is present but Origin is set', () => {
    expect(isSameOrigin('http://localhost:3000', undefined)).toBe(false)
  })

  it('allows HTTPS origin matching HTTPS host', () => {
    expect(isSameOrigin('https://app.example.com', 'app.example.com')).toBe(true)
  })
})

describe('unauthorized API access simulation', () => {
  it('verifySessionToken returns null for missing token (401 scenario)', async () => {
    const { verifySessionToken } = await import('../server/utils/session')
    expect(verifySessionToken('')).toBeNull()
    expect(verifySessionToken('garbage.token')).toBeNull()
  })
})
