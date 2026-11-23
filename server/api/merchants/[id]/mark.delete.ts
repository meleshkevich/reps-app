import { deleteMerchantMark, SandboxApiError } from '~/server/utils/sandbox'

export default defineEventHandler(async (event) => {
  const merchantId = getRouterParam(event, 'id')
  if (!merchantId) {
    setResponseStatus(event, 400)
    return { error: 'merchant_id is required' }
  }

  try {
    return await deleteMerchantMark(merchantId)
  } catch (err) {
    if (err instanceof SandboxApiError) {
      setResponseStatus(event, err.status >= 500 ? 502 : err.status)
      return { error: 'Upstream service error' }
    }
    setResponseStatus(event, 502)
    return { error: 'Service unavailable' }
  }
})
