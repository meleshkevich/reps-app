import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'session'
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000

export interface SessionPayload {
  sub: string
  iat: number
  exp: number
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return secret
}

export function createSessionToken(secret?: string): string {
  const key = secret ?? getSessionSecret()
  const now = Date.now()
  const payload: SessionPayload = { sub: 'admin', iat: now, exp: now + SESSION_DURATION_MS }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', key).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifySessionToken(token: string, secret?: string): SessionPayload | null {
  try {
    const dot = token.lastIndexOf('.')
    if (dot === -1) return null
    const data = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const key = secret ?? getSessionSecret()
    const expected = createHmac('sha256', key).update(data).digest('base64url')
    const sigBuf = Buffer.from(sig, 'base64url')
    const expBuf = Buffer.from(expected, 'base64url')
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null
    const payload: SessionPayload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
