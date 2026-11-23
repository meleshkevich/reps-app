<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">Groupon Rep Tool</h1>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-600">Groupon Admin</span>
        <button
          class="text-sm text-gray-500 hover:text-gray-900"
          @click="logout"
        >
          Sign out
        </button>
      </div>
    </header>
    <main class="max-w-screen-md mx-auto px-4 py-6">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  await navigateTo('/login')
}
</script>
