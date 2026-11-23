export default defineEventHandler((event) => {
  const origin = getRequestHeader(event, 'origin')
  const host = getRequestHeader(event, 'host')
  if (!isSameOrigin(origin, host)) {
    setResponseStatus(event, 403)
    return { error: 'Forbidden' }
  }

  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  return { ok: true }
})
