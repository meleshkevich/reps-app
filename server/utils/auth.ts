import { timingSafeEqual } from 'node:crypto'

export const ADMIN_EMAIL = 'admin@groupon.com'

export function validateCredentials(email: string, password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) return false
  if (email !== ADMIN_EMAIL) return false
  if (!password || password.length !== adminPassword.length) return false
  return timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword))
}

export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
