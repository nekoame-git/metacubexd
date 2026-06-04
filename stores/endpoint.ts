import type { Endpoint } from '~/types'
import { defineStore } from 'pinia'

export const useEndpointStore = defineStore('endpoint', () => {
  const runtimeConfig = useRuntimeConfig()
  const serverEndpointLabel = 'MetaCubeXD server backend'

  // State
  const selectedEndpoint = useLocalStorage<string>('selectedEndpoint', '')
  const savedEndpointList = useLocalStorage<Endpoint[]>('endpointList', [])
  const serverEndpoint = computed<Endpoint | null>(() => {
    if (runtimeConfig.public.serverBackendMode !== true) return null
    return {
      id: 'server-backend',
      url: serverEndpointLabel,
      secret: '',
    }
  })
  const endpointList = computed<Endpoint[]>(() => {
    const endpoint = serverEndpoint.value
    return endpoint
      ? [endpoint, ...savedEndpointList.value]
      : savedEndpointList.value
  })

  // Getters
  const currentEndpoint = computed(() =>
    endpointList.value.find(({ id }) => id === selectedEndpoint.value),
  )

  const wsEndpointURL = computed(() => {
    const endpoint = currentEndpoint.value
    if (!endpoint) return ''
    try {
      return new URL(endpoint.url).href
        .replace(/^http/, 'ws')
        .replace(/\/$/, '')
    } catch {
      return ''
    }
  })

  // Actions
  const setSelectedEndpoint = (id: string) => {
    selectedEndpoint.value = id
  }

  const setEndpointList = (list: Endpoint[]) => {
    savedEndpointList.value = list.filter((e) => e.id !== 'server-backend')
  }

  const addEndpoint = (endpoint: Endpoint) => {
    if (endpoint.id === 'server-backend') return
    savedEndpointList.value = [endpoint, ...savedEndpointList.value]
  }

  const removeEndpoint = (id: string) => {
    if (id === 'server-backend') return
    savedEndpointList.value = savedEndpointList.value.filter((e) => e.id !== id)
    if (selectedEndpoint.value === id) {
      selectedEndpoint.value = ''
    }
  }

  const updateEndpoint = (id: string, updates: Partial<Endpoint>) => {
    if (id === 'server-backend') return
    const index = savedEndpointList.value.findIndex((e) => e.id === id)
    const existing = savedEndpointList.value[index]
    if (index !== -1 && existing) {
      savedEndpointList.value[index] = { ...existing, ...updates } as Endpoint
    }
  }

  return {
    selectedEndpoint,
    endpointList,
    currentEndpoint,
    wsEndpointURL,
    setSelectedEndpoint,
    setEndpointList,
    addEndpoint,
    removeEndpoint,
    updateEndpoint,
  }
})
