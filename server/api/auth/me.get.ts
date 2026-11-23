export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE)
  const session = token ? verifySessionToken(token) : null
  if (!session) {
    setResponseStatus(event, 401)
    return { error: 'Unauthorized' }
  }
  return { sub: session.sub }
})
