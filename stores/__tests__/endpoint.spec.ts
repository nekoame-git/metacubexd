import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEndpointStore } from '../endpoint'

describe('stores/endpoint server backend preset', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('adds a server backend endpoint when server backend mode is enabled', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        serverBackendMode: true,
      },
    }))

    const store = useEndpointStore()

    expect(store.endpointList[0]).toEqual({
      id: 'server-backend',
      url: 'MetaCubeXD server backend',
      secret: '',
    })

    store.setSelectedEndpoint('server-backend')
    expect(store.currentEndpoint?.id).toBe('server-backend')
  })

  it('does not persist the server backend endpoint into saved endpoint list', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        serverBackendMode: true,
      },
    }))

    const store = useEndpointStore()
    store.setEndpointList([
      { id: 'server-backend', url: 'ignored', secret: 'ignored' },
      { id: 'manual', url: 'http://127.0.0.1:9090', secret: 'secret' },
    ])

    expect(store.endpointList).toEqual([
      {
        id: 'server-backend',
        url: 'MetaCubeXD server backend',
        secret: '',
      },
      { id: 'manual', url: 'http://127.0.0.1:9090', secret: 'secret' },
    ])
  })
})
