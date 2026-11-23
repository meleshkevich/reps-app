import { setMerchantMark, SandboxApiError } from '~/server/utils/sandbox'
import { ADMIN_IDENTITY } from '~/server/utils/identity'
import { validateMarkReason } from '~/server/utils/marks'

export default defineEventHandler(async (event) => {
  const merchantId = getRouterParam(event, 'id')
  if (!merchantId) {
    setResponseStatus(event, 400)
    return { error: 'merchant_id is required' }
  }

  const body = await readBody(event)
  const validation = validateMarkReason(body?.reason)
  if (!validation.valid) {
    setResponseStatus(event, 400)
    return { error: validation.error }
  }

  try {
    return await setMerchantMark(merchantId, {
      mark: 'no_call',
      reason: validation.value,
      marked_by: ADMIN_IDENTITY.displayName,
    })
  } catch (err) {
    if (err instanceof SandboxApiError) {
      setResponseStatus(event, err.status >= 500 ? 502 : err.status)
      return { error: 'Upstream service error' }
    }
    setResponseStatus(event, 502)
    return { error: 'Service unavailable' }
  }
})
