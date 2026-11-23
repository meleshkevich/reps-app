export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const { allowed } = checkRateLimit(`login:${ip}`)
  if (!allowed) {
    setResponseStatus(event, 429)
    return { error: 'Too many login attempts. Try again later.' }
  }

  const origin = getRequestHeader(event, 'origin')
  const host = getRequestHeader(event, 'host')
  if (!isSameOrigin(origin, host)) {
    setResponseStatus(event, 403)
    return { error: 'Forbidden' }
  }

  const body = await readBody<{ email?: string; password?: string }>(event)
  const { email = '', password = '' } = body ?? {}

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    setResponseStatus(event, 500)
    return { error: 'Server configuration error' }
  }

  const valid = validateCredentials(email, password)
  if (!valid) {
    setResponseStatus(event, 401)
    return { error: 'Invalid credentials' }
  }

  const token = createSessionToken()
  const isProduction = process.env.NODE_ENV === 'production'

  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 8 * 60 * 60,
    path: '/',
  })

  return { ok: true }
})
