import { getMerchants, SandboxApiError } from '~/server/utils/sandbox'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined
  const limit = typeof query.limit === 'string' ? parseInt(query.limit, 10) || undefined : undefined
  const q = typeof query.q === 'string' ? query.q : undefined
  const category = typeof query.category === 'string' ? query.category : undefined
  const region = typeof query.region === 'string' ? query.region : undefined
  const rep_id = typeof query.rep_id === 'string' ? query.rep_id : undefined

  try {
    return await getMerchants({ cursor, limit, q, category, region, rep_id })
  } catch (err) {
    if (err instanceof SandboxApiError) {
      setResponseStatus(event, err.status >= 500 ? 502 : err.status)
      return { error: 'Upstream service error' }
    }
    setResponseStatus(event, 502)
    return { error: 'Service unavailable' }
  }
})
