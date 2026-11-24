/**
 * POST /api/analyze-merchant
 *
 * Authenticated endpoint that runs the full evidence analysis pipeline:
 * collect → normalize → token map → LLM → validate → resolve.
 *
 * The browser supplies only merchantId. All other inputs are server-side.
 * Does not write to the Sandbox API.
 */

import { getMerchantDeals, SandboxApiError } from '~/server/utils/sandbox'
import { collectEvidence } from '~/server/utils/evidenceCollector'
import { callLLM } from '~/server/utils/llmGateway'
import { buildEvidenceTokenMap, validateAndResolveEvidence } from '~/utils/evidence'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const merchantId = typeof body?.merchantId === 'string' ? body.merchantId.trim() : ''

  if (!merchantId) {
    setResponseStatus(event, 400)
    return { status: 'error', error: 'merchantId is required' }
  }

  // Retrieve merchant's deals to build allowedDealIds for ownership verification.
  // Fetching up to 100 deals; merchants with more than 100 deals will have partial coverage.
  let allowedDealIds: ReadonlySet<string>
  try {
    const dealsRes = await getMerchantDeals(merchantId, { limit: 100 })
    allowedDealIds = new Set(dealsRes.data.map((d) => d.deal_id))
  } catch (err) {
    if (err instanceof SandboxApiError && err.status < 500) {
      setResponseStatus(event, 400)
      return { status: 'error', error: 'Merchant not found or inaccessible' }
    }
    setResponseStatus(event, 502)
    return { status: 'llm_unavailable', error: 'Failed to retrieve merchant deals' }
  }

  // Collect and normalize evidence from all 4 sources.
  const collection = await collectEvidence(merchantId, allowedDealIds)

  if (collection.incomplete) {
    setResponseStatus(event, 206)
    return {
      status: 'incomplete_evidence',
      failedSources: collection.failedSources,
      samplingMeta: collection.samplingMeta,
    }
  }

  if (collection.records.length === 0) {
    return {
      status: 'no_evidence',
      samplingMeta: collection.samplingMeta,
    }
  }

  // Build request-scoped token map.
  const tokenMap = buildEvidenceTokenMap(collection.records)

  // Single LLM call.
  const llmResult = await callLLM(merchantId, tokenMap)

  if (!llmResult.ok) {
    setResponseStatus(event, 502)
    return {
      status: 'llm_unavailable',
      error: llmResult.error,
    }
  }

  // Deterministic validation and resolution.
  const validation = validateAndResolveEvidence(
    llmResult.rawOutput,
    tokenMap,
    merchantId,
    allowedDealIds,
  )

  if (!validation.ok) {
    setResponseStatus(event, 502)
    return {
      status: 'invalid_response',
      issues: validation.issues.map((i) => i.message),
    }
  }

  if (validation.signals.length === 0) {
    return {
      status: 'no_signals',
      samplingMeta: collection.samplingMeta,
      model: llmResult.model,
      usage: llmResult.usage,
    }
  }

  return {
    status: 'ok',
    signals: validation.signals,
    samplingMeta: collection.samplingMeta,
    model: llmResult.model,
    usage: llmResult.usage,
  }
})
