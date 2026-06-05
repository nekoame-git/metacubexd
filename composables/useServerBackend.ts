/**
 * Server-persisted backend mode: API + realtime data + traffic DB all go through
 * the MetaCubeXD container (/api/backend, /api/traffic/*), not the browser.
 *
 * runtimeConfig.public.serverBackendMode is set at image build or via
 * NUXT_PUBLIC_SERVER_BACKEND_MODE at container start. When the image was built
 * without those env vars, we probe the same-origin traffic API at runtime so LAN
 * and remote tunnel clients behave identically.
 */

const detectedServerBackend = ref<boolean | null>(null)
let detectPromise: Promise<boolean> | null = null

export function useIsServerBackendMode() {
  const runtimeConfig = useRuntimeConfig()
  return computed(
    () =>
      runtimeConfig.public.serverBackendMode === true ||
      detectedServerBackend.value === true,
  )
}

export async function detectServerBackendMode(): Promise<boolean> {
  const runtimeConfig = useRuntimeConfig()
  if (runtimeConfig.public.serverBackendMode === true) {
    detectedServerBackend.value = true
    return true
  }

  if (detectedServerBackend.value !== null) {
    return detectedServerBackend.value
  }

  if (!detectPromise) {
    detectPromise = (async () => {
      try {
        const status = await $fetch<{ backendUrl?: string }>(
          '/api/traffic/status',
          { timeout: 4000 },
        )
        const ok = Boolean(status?.backendUrl)
        detectedServerBackend.value = ok
        return ok
      } catch {
        try {
          await $fetch('/api/backend/version', { timeout: 4000 })
          detectedServerBackend.value = true
          return true
        } catch {
          detectedServerBackend.value = false
          return false
        }
      }
    })()
  }

  return detectPromise
}

export function applyServerBackendEndpoint() {
  const endpointStore = useEndpointStore()
  endpointStore.setSelectedEndpoint('server-backend')
}

// Test-only helper: resets the module-level detection cache between specs.
export function resetServerBackendDetectionForTests() {
  detectedServerBackend.value = null
  detectPromise = null
}
