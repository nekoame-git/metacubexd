import {
  getBackendRuntimeConfig,
  toBackendWebSocketUrl,
} from './traffic/config'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export function getBackendConfig() {
  return getBackendRuntimeConfig()
}

export function createBackendHeaders(
  input?: HeadersInit,
  includeSecret = true,
) {
  const config = getBackendConfig()
  const headers = new Headers(input)
  for (const key of Array.from(headers.keys())) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.delete(key)
  }
  if (includeSecret && config.backendSecret) {
    headers.set('Authorization', `Bearer ${config.backendSecret}`)
  }
  return headers
}

export function createBackendHttpUrl(path: string, search = '') {
  const config = getBackendConfig()
  if (!config.backendUrl) {
    throw createError({
      statusCode: 503,
      statusMessage: 'METACUBEXD_BACKEND_URL is not configured',
    })
  }
  const normalizedPath = path.replace(/^\/+/, '')
  return `${config.backendUrl}/${normalizedPath}${search}`
}

export function isBackendStreamingPath(path: string) {
  const normalizedPath = path.replace(/^\/+/, '').split(/[?#]/)[0] ?? ''
  return ['traffic', 'memory', 'logs'].includes(normalizedPath)
}

export function createBackendWsUrl(
  path: string,
  searchParams?: URLSearchParams,
) {
  const config = getBackendConfig()
  const wsBaseUrl = toBackendWebSocketUrl(config.backendUrl)
  if (!wsBaseUrl) {
    throw new Error('METACUBEXD_BACKEND_URL is not configured')
  }

  const params = new URLSearchParams(searchParams)
  if (config.backendSecret) params.set('token', config.backendSecret)
  const query = params.toString()
  return `${wsBaseUrl}/${path.replace(/^\/+/, '')}${query ? `?${query}` : ''}`
}
