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
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { SoldOutsTodayResponse } from '~/server/utils/sandbox'

const { data, pending, error } = await useFetch<SoldOutsTodayResponse>('/api/soldouts/today')

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
</script>
