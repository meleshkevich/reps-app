import { createHmac } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSessionToken, verifySessionToken } from '../server/utils/session'

const TEST_SECRET = 'test-secret-that-is-at-least-32-chars-long!!'

describe('createSessionToken', () => {
  it('returns a dot-separated token', () => {
    const token = createSessionToken(TEST_SECRET)
    expect(token.split('.').length).toBe(2)
  })

  it('embeds a future expiry', () => {
    const token = createSessionToken(TEST_SECRET)
    const [data] = token.split('.')
    const payload = JSON.parse(Buffer.from(data!, 'base64url').toString())
    expect(payload.exp).toBeGreaterThan(Date.now())
  })
})

describe('verifySessionToken', () => {
  it('accepts a valid token', () => {
    const token = createSessionToken(TEST_SECRET)
    const result = verifySessionToken(token, TEST_SECRET)
    expect(result).not.toBeNull()
    expect(result?.sub).toBe('admin')
  })

  it('rejects a tampered payload', () => {
    const token = createSessionToken(TEST_SECRET)
    const [data, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(data!, 'base64url').toString())
    payload.sub = 'hacker'
    const tampered = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const result = verifySessionToken(`${tampered}.${sig}`, TEST_SECRET)
    expect(result).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const token = createSessionToken(TEST_SECRET)
    const [data] = token.split('.')
    const result = verifySessionToken(`${data}.invalidsig`, TEST_SECRET)
    expect(result).toBeNull()
  })

  it('rejects a token signed with the wrong secret', () => {
    const token = createSessionToken('wrong-secret-at-least-32-chars-loooong')
    const result = verifySessionToken(token, TEST_SECRET)
    expect(result).toBeNull()
  })

  it('rejects an expired token', () => {
    const token = createSessionToken(TEST_SECRET)
    const [data] = token.split('.')
    const payload = JSON.parse(Buffer.from(data!, 'base64url').toString())
    payload.exp = Date.now() - 1000
    const expiredData = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const newSig = createHmac('sha256', TEST_SECRET).update(expiredData).digest('base64url')
    const result = verifySessionToken(`${expiredData}.${newSig}`, TEST_SECRET)
    expect(result).toBeNull()
  })

  it('rejects a token with no dot separator', () => {
    expect(verifySessionToken('nodothere', TEST_SECRET)).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(verifySessionToken('', TEST_SECRET)).toBeNull()
  })
})

describe('verifySessionToken with process.env secret', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', TEST_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads the secret from process.env when not passed explicitly', () => {
    const token = createSessionToken()
    expect(verifySessionToken(token)).not.toBeNull()
  })
})
