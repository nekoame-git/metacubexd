import type { BackendRuntimeConfig } from './types'

const DEFAULT_DB_PATH =
  process.env.NODE_ENV === 'development'
    ? '.data/traffic.sqlite'
    : '/data/traffic.sqlite'
const DEFAULT_RETENTION_DAYS = 180

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeBackendUrl(url: string) {
  return url.replace(/\/+$/, '')
}

export function getBackendRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackendRuntimeConfig {
  const backendUrl = normalizeBackendUrl(
    env.METACUBEXD_BACKEND_URL || env.DEFAULT_BACKEND_URL || '',
  )

  return {
    backendUrl,
    backendSecret: env.METACUBEXD_BACKEND_SECRET || '',
    trafficEnabled: readBoolean(env.METACUBEXD_TRAFFIC_ENABLED, !!backendUrl),
    trafficDbPath: env.METACUBEXD_TRAFFIC_DB_PATH || DEFAULT_DB_PATH,
    trafficRetentionDays: readPositiveInteger(
      env.METACUBEXD_TRAFFIC_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
    ),
  }
}

export function toBackendWebSocketUrl(backendUrl: string) {
  if (!backendUrl) return ''
  try {
    return new URL(backendUrl).href.replace(/^http/, 'ws').replace(/\/$/, '')
  } catch {
    return ''
  }
}
