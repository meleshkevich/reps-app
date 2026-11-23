import { getMerchantDeals, SandboxApiError } from '~/server/utils/sandbox'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const merchantId = typeof query.merchant_id === 'string' ? query.merchant_id : ''
  if (!merchantId) {
    setResponseStatus(event, 400)
    return { error: 'merchant_id is required' }
  }

  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined
  const limit = typeof query.limit === 'string' ? parseInt(query.limit, 10) || undefined : undefined

  try {
    return await getMerchantDeals(merchantId, { cursor, limit })
  } catch (err) {
    if (err instanceof SandboxApiError) {
      setResponseStatus(event, err.status >= 500 ? 502 : err.status)
      return { error: 'Upstream service error' }
    }
    setResponseStatus(event, 502)
    return { error: 'Service unavailable' }
  }
})
