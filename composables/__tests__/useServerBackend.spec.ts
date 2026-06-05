import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyServerBackendEndpoint,
  detectServerBackendMode,
  resetServerBackendDetectionForTests,
  useIsServerBackendMode,
} from '../useServerBackend'

describe('useServerBackend', () => {
  beforeEach(() => {
    resetServerBackendDetectionForTests()
    localStorage.clear()
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        serverBackendMode: false,
      },
    }))
    vi.stubGlobal('$fetch', vi.fn())
  })

  it('uses runtime config when serverBackendMode is enabled at build/runtime', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { serverBackendMode: true },
    }))

    expect(useIsServerBackendMode().value).toBe(true)
    await expect(detectServerBackendMode()).resolves.toBe(true)
  })

  it('detects server backend from /api/traffic/status', async () => {
    vi.mocked($fetch).mockResolvedValueOnce({
      backendUrl: 'http://192.168.124.8:9090',
      enabled: true,
    })

    await expect(detectServerBackendMode()).resolves.toBe(true)
    expect(useIsServerBackendMode().value).toBe(true)
  })

  it('falls back to /api/backend/version when status is unavailable', async () => {
    vi.mocked($fetch)
      .mockRejectedValueOnce(new Error('status unavailable'))
      .mockResolvedValueOnce({ version: 'test' })

    await expect(detectServerBackendMode()).resolves.toBe(true)
    expect(useIsServerBackendMode().value).toBe(true)
  })

  it('selects the server backend endpoint preset', () => {
    const setSelectedEndpoint = vi.fn()
    vi.stubGlobal('useEndpointStore', () => ({ setSelectedEndpoint }))

    applyServerBackendEndpoint()

    expect(setSelectedEndpoint).toHaveBeenCalledWith('server-backend')
  })
})
