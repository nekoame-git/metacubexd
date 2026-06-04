import type { TrafficStorage } from './storage'
import type {
  ConnectionRawMessage,
  ConnectionsMessage,
  TrafficConnectionRecord,
} from './types'

interface LastConnectionData {
  upload: number
  download: number
}

function parseStartTime(start: string | undefined, fallback: number) {
  if (!start) return fallback
  const parsed = Date.parse(start)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getConnectionRecord(
  connection: ConnectionRawMessage,
  now: number,
): TrafficConnectionRecord {
  const metadata = connection.metadata || ({} as any)
  const chains = connection.chains?.length ? connection.chains : ['DIRECT']
  return {
    connectionId: connection.id,
    startTime: parseStartTime(connection.start, now),
    sourceIP: metadata.sourceIP || 'Inner',
    host:
      metadata.host ||
      metadata.destinationIP ||
      metadata.remoteDestination ||
      'Unknown',
    destinationIP: metadata.destinationIP || '',
    destinationPort: metadata.destinationPort || '',
    network: metadata.network || '',
    process: metadata.process || 'Unknown',
    inboundUser:
      metadata.inboundUser ||
      metadata.inboundIP ||
      metadata.inboundName ||
      metadata.type ||
      'Unknown',
    inboundName: metadata.inboundName || metadata.type || '',
    rule: connection.rule || 'MATCH',
    rulePayload: connection.rulePayload || '',
    outbound: chains[0] || 'DIRECT',
    chains,
  }
}

function normalizeBucketTime(timestamp: number) {
  return Math.floor(timestamp / 60_000) * 60_000
}

export function createTrafficCollectorCore(
  storage: TrafficStorage,
  getNow = () => Date.now(),
) {
  const lastConnectionData = new Map<string, LastConnectionData>()
  const activeConnectionIds = new Set<string>()
  let lastUploadTotal = 0
  let lastDownloadTotal = 0

  function resetBaselines() {
    lastConnectionData.clear()
    activeConnectionIds.clear()
  }

  function handleConnectionsMessage(msg: ConnectionsMessage) {
    const now = getNow()
    const connections = msg?.connections || []
    const currentUploadTotal = msg?.uploadTotal || 0
    const currentDownloadTotal = msg?.downloadTotal || 0

    const hasReset =
      currentUploadTotal < lastUploadTotal ||
      currentDownloadTotal < lastDownloadTotal
    if (hasReset) {
      resetBaselines()
    }
    lastUploadTotal = currentUploadTotal
    lastDownloadTotal = currentDownloadTotal

    const nextActiveIds = new Set<string>()
    for (const connection of connections) {
      nextActiveIds.add(connection.id)
      storage.upsertConnection(getConnectionRecord(connection, now))

      const currentUpload = connection.upload || 0
      const currentDownload = connection.download || 0
      const previous = lastConnectionData.get(connection.id)
      const upload = previous
        ? Math.max(0, currentUpload - previous.upload)
        : currentUpload
      const download = previous
        ? Math.max(0, currentDownload - previous.download)
        : currentDownload

      lastConnectionData.set(connection.id, {
        upload: currentUpload,
        download: currentDownload,
      })

      if (!hasReset && (upload > 0 || download > 0)) {
        storage.addTrafficDelta({
          connectionId: connection.id,
          bucketTime: normalizeBucketTime(now),
          upload,
          download,
        })
      }
    }

    for (const id of activeConnectionIds) {
      if (!nextActiveIds.has(id)) {
        storage.closeConnection(id, now)
        lastConnectionData.delete(id)
      }
    }

    activeConnectionIds.clear()
    for (const id of nextActiveIds) activeConnectionIds.add(id)
  }

  return {
    handleConnectionsMessage,
    resetBaselines,
  }
}

export type TrafficCollectorCore = ReturnType<typeof createTrafficCollectorCore>
