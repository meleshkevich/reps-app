import { getMarks, SandboxApiError } from '~/server/utils/sandbox'

export default defineEventHandler(async (event) => {
  try {
    return await getMarks()
  } catch (err) {
    if (err instanceof SandboxApiError) {
      setResponseStatus(event, err.status >= 500 ? 502 : err.status)
      return { error: 'Upstream service error' }
    }
    setResponseStatus(event, 502)
    return { error: 'Service unavailable' }
  }
})
