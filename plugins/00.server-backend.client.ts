import { detectServerBackendMode } from '~/composables/useServerBackend'

// Pre-warm server-backend detection so the first route middleware and component
// setup can read useIsServerBackendMode() without re-probing. Endpoint selection
// is handled by the global auth middleware (after Pinia is initialized), so this
// plugin intentionally does not touch any store.
export default defineNuxtPlugin({
  name: 'server-backend',
  setup() {
    // Fire-and-forget: kick off detection without blocking app startup. When
    // serverBackendMode is already set via env, this resolves synchronously with
    // no network call. The global auth middleware awaits the same (deduped)
    // promise before the first page renders.
    void detectServerBackendMode()
  },
})
