<template>
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Today's Sold-Outs</h1>
      <p v-if="data && !pending" class="text-sm text-gray-500 mt-1">
        {{ data.world_day }} &middot; {{ data.date }} &middot; Team time {{ data.team_time }}
      </p>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="space-y-3">
      <div v-for="i in 4" :key="i" class="bg-white rounded-lg border p-4 animate-pulse">
        <div class="h-5 bg-gray-200 rounded w-1/2 mb-2" />
        <div class="h-4 bg-gray-100 rounded w-3/4 mb-3" />
        <div class="flex gap-2">
          <div class="h-5 bg-gray-100 rounded-full w-16" />
          <div class="h-5 bg-gray-100 rounded-full w-20" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm"
    >
      Failed to load sold-outs. Please refresh the page.
    </div>

    <!-- Empty -->
    <div
      v-else-if="!data?.total"
      class="text-center py-12 text-gray-500"
    >
      No sold-outs today.
    </div>

    <!-- Data -->
    <template v-else>
      <p class="text-sm text-gray-500 mb-3">
        {{ data.total }} sold-out{{ data.total !== 1 ? 's' : '' }}
      </p>
      <div class="space-y-3">
        <div
          v-for="item in data.data"
          :key="item.sold_out_id"
          class="bg-white rounded-lg border shadow-sm p-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-gray-900 truncate">{{ item.merchant_name }}</p>
              <p class="text-sm text-gray-600 truncate mt-0.5">{{ item.deal_name }}</p>
            </div>
            <span class="shrink-0 text-sm font-mono text-gray-500 mt-0.5">
              {{ formatTime(item.sold_out_at) }}
            </span>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span class="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
              {{ item.category }}
            </span>
            <span class="bg-gray-50 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-full">
              {{ item.city }}, {{ item.region }}
            </span>
            <span class="bg-gray-50 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-full">
              Cap {{ item.cap }}
            </span>
            <span
              v-if="item.rep_name"
              class="bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-full"
            >
              {{ item.rep_name }}
            </span>
            <span
              v-if="item.do_not_contact"
              class="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-medium"
            >
              DNC
            </span>
            <span
              v-if="item.posted_in_channel"
              class="bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full"
            >
              Posted
            </span>
            <span
              v-if="marksMap.get(item.merchant_id)"
              class="bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-medium"
            >
              Do not call
            </span>
          </div>

          <!-- Mark controls and analysis: shown once per merchant (first occurrence only) -->
          <div
            v-if="firstOccurrenceSoldOutIds.has(item.sold_out_id)"
            class="mt-3 border-t border-gray-100 pt-3"
          >
            <!-- Financial estimate -->
            <p
              v-if="merchantRecommendation(item).recommendation === 'review'"
              class="text-xs text-gray-400 mb-2"
            >
              Estimate unavailable — financial inputs not provided by sandbox.
            </p>

            <!-- Edit form -->
            <template v-if="editingMerchantId === item.merchant_id">
              <p class="text-xs text-gray-500 mb-1.5">
                {{ marksMap.get(item.merchant_id) ? 'Edit reason' : 'Mark as Do Not Call' }}
              </p>
              <textarea
                v-model="editReason"
                class="w-full text-sm border border-gray-300 rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400"
                rows="2"
                placeholder="Reason…"
                maxlength="500"
              />
              <p class="text-xs text-gray-400 mt-1">
                This records merchant feedback. It does not automatically remove restock tasks.
              </p>
              <p v-if="markError[item.merchant_id]" class="text-xs text-red-600 mt-1">
                {{ markError[item.merchant_id] }}
              </p>
              <div class="flex gap-2 mt-2">
                <button
                  class="text-xs bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700 disabled:opacity-50"
                  :disabled="!!markSubmitting[item.merchant_id]"
                  @click="submitMark(item.merchant_id)"
                >
                  {{ markSubmitting[item.merchant_id] ? 'Saving…' : 'Save' }}
                </button>
                <button
                  class="text-xs text-gray-500 hover:text-gray-900"
                  @click="cancelEdit"
                >
                  Cancel
                </button>
              </div>
            </template>

            <!-- Existing mark -->
            <template v-else-if="marksMap.get(item.merchant_id)">
              <p class="text-xs text-gray-500 mb-0.5">
                Reason: {{ marksMap.get(item.merchant_id)!.reason }}
              </p>
              <p v-if="marksMap.get(item.merchant_id)!.marked_by" class="text-xs text-gray-400 mb-1">
                Marked by: {{ marksMap.get(item.merchant_id)!.marked_by }}
              </p>
              <p v-if="markError[item.merchant_id]" class="text-xs text-red-600 mb-1">
                {{ markError[item.merchant_id] }}
              </p>
              <div class="flex gap-3">
                <button
                  class="text-xs text-blue-600 hover:underline disabled:opacity-50"
                  :disabled="!!markSubmitting[item.merchant_id]"
                  @click="startEdit(item.merchant_id)"
                >
                  Edit reason
                </button>
                <button
                  class="text-xs text-red-600 hover:underline disabled:opacity-50"
                  :disabled="!!markSubmitting[item.merchant_id]"
                  @click="removeMark(item.merchant_id)"
                >
                  {{ markSubmitting[item.merchant_id] ? 'Removing…' : 'Remove mark' }}
                </button>
              </div>
            </template>

            <!-- No mark -->
            <template v-else>
              <p v-if="markError[item.merchant_id]" class="text-xs text-red-600 mb-1">
                {{ markError[item.merchant_id] }}
              </p>
              <button
                class="text-xs text-orange-600 hover:underline disabled:opacity-50"
                :disabled="!!markSubmitting[item.merchant_id]"
                @click="startEdit(item.merchant_id)"
              >
                + Mark as Do Not Call
              </button>
            </template>

            <!-- Evidence analysis section -->
            <div class="mt-3 pt-2 border-t border-gray-50">
              <button
                class="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                :disabled="analysisState[item.merchant_id] === 'loading'"
                @click="analyzeEvidence(item.merchant_id)"
              >
                {{ analysisState[item.merchant_id] === 'loading' ? 'Analyzing evidence…' : 'Analyze evidence' }}
              </button>

              <!-- Analysis result -->
              <div v-if="analysisResults[item.merchant_id]" class="mt-2">
                <p
                  v-if="analysisResults[item.merchant_id].status === 'no_evidence'"
                  class="text-xs text-gray-400"
                >
                  No source evidence found for this merchant.
                </p>
                <p
                  v-else-if="analysisResults[item.merchant_id].status === 'no_signals'"
                  class="text-xs text-gray-400"
                >
                  No relevant signals found in evidence sample.
                </p>
                <p
                  v-else-if="analysisResults[item.merchant_id].status === 'incomplete_evidence'"
                  class="text-xs text-orange-600"
                >
                  Evidence collection incomplete — verify manually before calling.
                </p>
                <p
                  v-else-if="analysisResults[item.merchant_id].status === 'llm_unavailable' || analysisResults[item.merchant_id].status === 'invalid_response'"
                  class="text-xs text-red-600"
                >
                  Analysis unavailable — try again later.
                </p>

                <!-- Signals -->
                <template v-if="analysisResults[item.merchant_id].status === 'ok'">
                  <div
                    v-for="(signal, si) in analysisResults[item.merchant_id].signals"
                    :key="si"
                    class="mt-2"
                  >
                    <p class="text-xs font-medium text-gray-700">{{ signalLabel(signal.type) }}</p>
                    <div
                      v-for="(ref, ri) in signal.evidence"
                      :key="ri"
                      class="mt-1 ml-2 pl-2 border-l-2 border-indigo-100"
                    >
                      <p class="text-xs text-gray-600 italic">"{{ ref.quote }}"</p>
                      <p class="text-xs text-gray-400 mt-0.5">
                        Source verified · {{ ref.sourceType }} · {{ ref.sourceId }}
                        <span v-if="ref.timestamp"> · {{ formatDate(ref.timestamp) }}</span>
                      </p>
                    </div>
                  </div>

                  <p class="text-xs text-gray-400 mt-2">
                    Analyzed {{ analysisResults[item.merchant_id].samplingMeta?.totalSelected ?? 0 }} evidence records (sample, not complete history).
                    Positive signals do not override contact restrictions.
                  </p>

                  <!-- Rep feedback (session-local only) -->
                  <div class="flex gap-3 mt-2">
                    <template v-if="!analysisFeedback[item.merchant_id]">
                      <button
                        class="text-xs text-green-600 hover:underline"
                        @click="analysisFeedback[item.merchant_id] = 'confirmed'"
                      >
                        Confirm evidence
                      </button>
                      <button
                        class="text-xs text-orange-600 hover:underline"
                        @click="analysisFeedback[item.merchant_id] = 'flagged'"
                      >
                        Flag incorrect
                      </button>
                    </template>
                    <p v-else-if="analysisFeedback[item.merchant_id] === 'confirmed'" class="text-xs text-green-600">
                      Evidence confirmed (session only — not persisted)
                    </p>
                    <p v-else-if="analysisFeedback[item.merchant_id] === 'flagged'" class="text-xs text-orange-600">
                      Evidence flagged (session only — not persisted)
                    </p>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { SoldOutsTodayResponse, MarksResponse, Mark, TodaySoldOut } from '~/server/utils/sandbox'
import { getRecommendation } from '~/utils/finance'
import type { ScenarioResult } from '~/utils/finance'

// ---- Analysis types ----

interface AnalysisEvidenceRef {
  sourceToken: string
  sourceId: string
  sourceType: string
  merchantId: string
  dealId: string | null
  timestamp: string | null
  quote: string
}

interface AnalysisSignal {
  type: string
  evidence: AnalysisEvidenceRef[]
}

interface AnalysisSamplingMeta {
  totalFetched: number
  totalSelected: number
  bySource: Record<string, { fetched: number; selected: number; status: string }>
}

interface AnalysisResult {
  status: string
  signals?: AnalysisSignal[]
  samplingMeta?: AnalysisSamplingMeta
  model?: string
  usage?: { input_tokens: number; output_tokens: number } | null
  error?: string
  issues?: string[]
  failedSources?: string[]
}

const { data, pending, error } = await useFetch<SoldOutsTodayResponse>('/api/soldouts/today')
const { data: marksData, refresh: refreshMarks } = await useFetch<MarksResponse>('/api/marks')

const marksMap = computed(() => {
  const map = new Map<string, Mark>()
  for (const m of marksData.value?.data ?? []) {
    map.set(m.merchant_id, m)
  }
  return map
})

// sold_out_ids of the first occurrence of each merchant — mark controls show only there
const firstOccurrenceSoldOutIds = computed(() => {
  const seenMerchants = new Set<string>()
  const result = new Set<string>()
  for (const item of data.value?.data ?? []) {
    if (!seenMerchants.has(item.merchant_id)) {
      result.add(item.sold_out_id)
      seenMerchants.add(item.merchant_id)
    }
  }
  return result
})

// Financial estimates: sandbox does not supply the required inputs (GP per voucher,
// attribution factor, rep cost, refund data). All scenarios are incomplete — the
// recommendation engine falls through to rule 3 (missing inputs → review) for
// merchants without a DNC/no_call restriction. Rule 1 still fires for DNC/no_call.
const unavailableScenario: ScenarioResult = {
  repTimeCostPence: null,
  provisionalIncrementalGPPence: null,
  netExpectedGPPence: null,
  isComplete: false,
  missingInputs: ['financial inputs not provided by sandbox'],
  warnings: [],
  errors: [],
}

function merchantRecommendation(item: TodaySoldOut) {
  return getRecommendation({
    hasNoCallMark: marksMap.value.has(item.merchant_id),
    hasDoNotContact: item.do_not_contact,
    hasActiveAutoReplenish: null,
    financialResults: {
      low: unavailableScenario,
      base: unavailableScenario,
      high: unavailableScenario,
    },
  })
}

const editingMerchantId = ref<string | null>(null)
const editReason = ref('')
const markSubmitting = reactive<Record<string, boolean>>({})
const markError = reactive<Record<string, string | null>>({})

function startEdit(merchantId: string) {
  editingMerchantId.value = merchantId
  editReason.value = marksMap.value.get(merchantId)?.reason ?? ''
  markError[merchantId] = null
}

function cancelEdit() {
  editingMerchantId.value = null
  editReason.value = ''
}

async function submitMark(merchantId: string) {
  const reason = editReason.value.trim()
  if (!reason) {
    markError[merchantId] = 'Reason is required'
    return
  }
  markSubmitting[merchantId] = true
  markError[merchantId] = null
  try {
    await $fetch(`/api/merchants/${merchantId}/mark`, { method: 'PUT', body: { reason } })
    await refreshMarks()
    editingMerchantId.value = null
    editReason.value = ''
  } catch {
    markError[merchantId] = 'Failed to save mark. Please try again.'
  } finally {
    markSubmitting[merchantId] = false
  }
}

async function removeMark(merchantId: string) {
  markSubmitting[merchantId] = true
  markError[merchantId] = null
  try {
    await $fetch(`/api/merchants/${merchantId}/mark`, { method: 'DELETE' })
    await refreshMarks()
  } catch {
    markError[merchantId] = 'Failed to remove mark. Please try again.'
  } finally {
    markSubmitting[merchantId] = false
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

// ---- Evidence analysis ----

const analysisState = reactive<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({})
const analysisResults = reactive<Record<string, AnalysisResult>>({})
const analysisFeedback = reactive<Record<string, 'confirmed' | 'flagged' | null>>({})

const SIGNAL_LABELS: Record<string, string> = {
  restock_intent: 'Restock intent',
  restock_refusal: 'Restock refusal',
  callback_requested: 'Callback requested',
  capacity_risk: 'Capacity risk',
  refund_risk: 'Refund risk',
  contact_restriction: 'Contact restriction',
  automation_mentioned: 'Automation mentioned',
  other_relevant: 'Other relevant',
}

function signalLabel(type: string): string {
  return SIGNAL_LABELS[type] ?? type
}

async function analyzeEvidence(merchantId: string) {
  if (analysisState[merchantId] === 'loading') return
  analysisState[merchantId] = 'loading'
  analysisFeedback[merchantId] = null
  try {
    const result = await $fetch<AnalysisResult>('/api/analyze-merchant', {
      method: 'POST',
      body: { merchantId },
      ignoreResponseError: true,
    })
    analysisResults[merchantId] = result
    analysisState[merchantId] = 'done'
  } catch {
    analysisResults[merchantId] = { status: 'llm_unavailable' }
    analysisState[merchantId] = 'done'
  }
}
</script>
