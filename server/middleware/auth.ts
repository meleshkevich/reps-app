export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  const isPublic =
    path === '/login' ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/_nuxt/') ||
    path.startsWith('/__nuxt') ||
    path === '/favicon.ico'

  if (isPublic) return

  let session = null
  try {
    const token = getCookie(event, SESSION_COOKIE)
    session = token ? verifySessionToken(token) : null
  } catch {
    // Missing SESSION_SECRET — treat as unauthenticated
  }

  if (!session) {
    if (path.startsWith('/api/')) {
      setResponseStatus(event, 401)
      return send(event, JSON.stringify({ error: 'Unauthorized' }), 'application/json')
    }
    return sendRedirect(event, '/login', 302)
  }
})
