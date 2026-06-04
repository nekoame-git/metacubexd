import type { TrafficStorage } from './storage'
import type { TrafficCollectorStatus } from './types'
import { Buffer } from 'node:buffer'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  createBackendHeaders,
  createBackendHttpUrl,
  createBackendWsUrl,
  getBackendConfig,
} from '../backend'
import { createTrafficCollectorCore } from './collector'
import { createTrafficStorage } from './storage'

const POLL_INTERVAL = 1000
const CLEANUP_INTERVAL = 60 * 60 * 1000
const STREAM_RECONNECT_DELAY = 3000

interface TrafficService {
  storage: TrafficStorage
  start: () => void
  stop: () => void
  getStatus: () => TrafficCollectorStatus
}

let service: TrafficService | null = null

function createService(): TrafficService {
  const config = getBackendConfig()
  mkdirSync(dirname(config.trafficDbPath), { recursive: true })
  const storage = createTrafficStorage(config.trafficDbPath)
  const collector = createTrafficCollectorCore(storage)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let cleanupTimer: ReturnType<typeof setInterval> | null = null
  const streamSockets = new Map<string, WebSocket>()
  const streamReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let started = false

  function cleanupExpired() {
    if (config.trafficRetentionDays <= 0) return
    const beforeTime =
      Date.now() - config.trafficRetentionDays * 24 * 60 * 60 * 1000
    storage.cleanupBefore(beforeTime)
  }

  async function pollConnections() {
    if (!config.trafficEnabled || !config.backendUrl) return

    try {
      const response = await fetch(createBackendHttpUrl('connections'), {
        headers: createBackendHeaders(),
      })
      if (!response.ok) {
        throw new Error(`connections poll failed: ${response.status}`)
      }
      const message = await response.json()
      collector.handleConnectionsMessage(message)
      storage.setConnectionsSnapshot(message, Date.now())
      storage.setCollectorStatus({ connected: true, lastError: '' })
    } catch (e) {
      storage.setCollectorStatus({
        connected: false,
        lastError: e instanceof Error ? e.message : String(e),
      })
    } finally {
      if (started && config.trafficEnabled) {
        pollTimer = setTimeout(pollConnections, POLL_INTERVAL)
      }
    }
  }

  function closeStream(path: string) {
    const ws = streamSockets.get(path)
    streamSockets.delete(path)
    try {
      ws?.close()
    } catch {
      // Ignore close errors from already-disconnected upstream sockets.
    }
  }

  function clearStreamReconnect(path: string) {
    const timer = streamReconnectTimers.get(path)
    if (timer) clearTimeout(timer)
    streamReconnectTimers.delete(path)
  }

  function scheduleStreamReconnect(
    path: string,
    onData: (data: unknown) => void,
  ) {
    if (!started || !config.trafficEnabled || !config.backendUrl) return
    if (streamReconnectTimers.has(path)) return
    const timer = setTimeout(() => {
      streamReconnectTimers.delete(path)
      connectStream(path, onData)
    }, STREAM_RECONNECT_DELAY)
    streamReconnectTimers.set(path, timer)
  }

  function connectStream(path: string, onData: (data: unknown) => void) {
    if (!config.trafficEnabled || !config.backendUrl) return

    closeStream(path)
    clearStreamReconnect(path)

    const ws = new WebSocket(createBackendWsUrl(path))
    streamSockets.set(path, ws)

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const raw =
          typeof event.data === 'string'
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString('utf8')
        onData(JSON.parse(raw))
      } catch (e) {
        storage.setCollectorStatus({
          lastError: e instanceof Error ? e.message : String(e),
        })
      }
    })
    ws.addEventListener('open', () => {
      storage.setCollectorStatus({ connected: true, lastError: '' })
    })
    ws.addEventListener('close', () => {
      streamSockets.delete(path)
      scheduleStreamReconnect(path, onData)
    })
    ws.addEventListener('error', () => {
      storage.setCollectorStatus({
        connected: false,
        lastError: `${path} stream disconnected`,
      })
    })
  }

  function connectStreams() {
    connectStream('traffic', (data) => {
      storage.setRealtimeTraffic(data as any, Date.now())
    })
    connectStream('memory', (data) => {
      storage.setRealtimeMemory(data as any, Date.now())
    })
    connectStream('logs', (data) => {
      storage.addLog(data as any, Date.now())
    })
  }

  return {
    storage,
    start() {
      if (started) return
      started = true
      storage.setCollectorStatus({
        connected: false,
        lastError: config.trafficEnabled ? '' : 'traffic collector disabled',
      })
      pollConnections()
      connectStreams()
      cleanupExpired()
      cleanupTimer = setInterval(cleanupExpired, CLEANUP_INTERVAL)
    },
    stop() {
      started = false
      if (pollTimer) clearTimeout(pollTimer)
      if (cleanupTimer) clearInterval(cleanupTimer)
      for (const path of Array.from(streamReconnectTimers.keys())) {
        clearStreamReconnect(path)
      }
      for (const path of Array.from(streamSockets.keys())) {
        closeStream(path)
      }
      pollTimer = null
      cleanupTimer = null
      storage.setCollectorStatus({ connected: false })
    },
    getStatus() {
      return {
        enabled: config.trafficEnabled,
        backendUrl: config.backendUrl,
        dbPath: config.trafficDbPath,
        retentionDays: config.trafficRetentionDays,
        ...storage.getStatus(),
      }
    },
  }
}

export function getTrafficService() {
  if (!service) service = createService()
  return service
}

export function startTrafficService() {
  getTrafficService().start()
}
