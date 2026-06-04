import type {
  ConnectionsMessage,
  ConnectionsSnapshot,
  RealtimeStateSnapshot,
  StoredLog,
  TrafficCollectorStatus,
  TrafficConnectionRecord,
  TrafficDelta,
  TrafficDetailsQuery,
  TrafficDimension,
  TrafficSummaryQuery,
  TrafficSummaryRow,
  TrafficTrendPoint,
  TrafficTrendQuery,
} from './types'
import type { Log, MemoryData, TrafficData } from '~/types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface TrafficStorage {
  upsertConnection: (record: TrafficConnectionRecord) => void
  closeConnection: (connectionId: string, endTime: number) => void
  addTrafficDelta: (delta: TrafficDelta) => void
  setRealtimeTraffic: (data: TrafficData, timestamp: number) => void
  setRealtimeMemory: (data: MemoryData, timestamp: number) => void
  getRealtimeState: () => RealtimeStateSnapshot
  setConnectionsSnapshot: (
    snapshot: ConnectionsMessage,
    timestamp: number,
  ) => void
  getConnectionsSnapshot: () => ConnectionsSnapshot
  addLog: (log: Log, timestamp: number) => void
  getLogs: (limit: number) => StoredLog[]
  cleanupBefore: (beforeTime: number) => void
  getSummary: (query: TrafficSummaryQuery) => TrafficSummaryRow[]
  getDetails: (query: TrafficDetailsQuery) => TrafficSummaryRow[]
  getTrend: (query: TrafficTrendQuery) => TrafficTrendPoint[]
  getStatus: () => Omit<
    TrafficCollectorStatus,
    'enabled' | 'backendUrl' | 'dbPath' | 'retentionDays'
  >
  setCollectorStatus: (status: {
    connected?: boolean
    lastWriteAt?: number
    lastError?: string
  }) => void
  close: () => void
}

const DIMENSION_COLUMNS: Record<TrafficDimension, string> = {
  sourceIP: 'source_ip',
  host: 'host',
  process: 'process',
  outbound: 'outbound',
  inboundUser: 'inbound_user',
  rule: "trim(rule || ' ' || rule_payload)",
}

const ALLOWED_BUCKETS = [
  60_000, 300_000, 900_000, 1_800_000, 3_600_000, 21_600_000, 86_400_000,
]

export function normalizeBucketSize(bucketSizeMs: number) {
  return ALLOWED_BUCKETS.includes(bucketSizeMs) ? bucketSizeMs : 60_000
}

function getDimensionExpression(dimension: TrafficDimension) {
  return DIMENSION_COLUMNS[dimension] || DIMENSION_COLUMNS.host
}

function normalizeBucketTime(timestamp: number, bucketSizeMs = 60_000) {
  const bucketSize = normalizeBucketSize(bucketSizeMs)
  return Math.floor(timestamp / bucketSize) * bucketSize
}

function rowsToSummary(rows: unknown[]): TrafficSummaryRow[] {
  return rows.map((row: any) => ({
    label: String(row.label || 'Unknown'),
    upload: Number(row.upload || 0),
    download: Number(row.download || 0),
    total: Number(row.total || 0),
    count: Number(row.count || 0),
  }))
}

export function createTrafficStorage(dbPath: string): TrafficStorage {
  mkdirSync(dirname(dbPath), { recursive: true })

  const database = new DatabaseSync(dbPath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS connection_records (
      connection_id TEXT PRIMARY KEY,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      source_ip TEXT NOT NULL,
      host TEXT NOT NULL,
      destination_ip TEXT NOT NULL,
      destination_port TEXT NOT NULL,
      network TEXT NOT NULL,
      process TEXT NOT NULL,
      inbound_user TEXT NOT NULL,
      inbound_name TEXT NOT NULL,
      rule TEXT NOT NULL,
      rule_payload TEXT NOT NULL,
      outbound TEXT NOT NULL,
      chains_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traffic_buckets (
      connection_id TEXT NOT NULL,
      bucket_time INTEGER NOT NULL,
      upload INTEGER NOT NULL DEFAULT 0,
      download INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (connection_id, bucket_time)
    );

    CREATE TABLE IF NOT EXISTS collector_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS realtime_state (
      key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backend_logs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_traffic_buckets_time
      ON traffic_buckets(bucket_time);
    CREATE INDEX IF NOT EXISTS idx_connection_records_source_ip
      ON connection_records(source_ip);
    CREATE INDEX IF NOT EXISTS idx_connection_records_host
      ON connection_records(host);
    CREATE INDEX IF NOT EXISTS idx_connection_records_outbound
      ON connection_records(outbound);
    CREATE INDEX IF NOT EXISTS idx_connection_records_process
      ON connection_records(process);
    CREATE INDEX IF NOT EXISTS idx_connection_records_inbound_user
      ON connection_records(inbound_user);
    CREATE INDEX IF NOT EXISTS idx_connection_records_rule
      ON connection_records(rule, rule_payload);
    CREATE INDEX IF NOT EXISTS idx_backend_logs_timestamp
      ON backend_logs(timestamp);
  `)

  const upsertConnectionStmt = database.prepare(`
    INSERT INTO connection_records (
      connection_id, start_time, end_time, source_ip, host, destination_ip,
      destination_port, network, process, inbound_user, inbound_name, rule,
      rule_payload, outbound, chains_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id) DO UPDATE SET
      end_time = excluded.end_time,
      source_ip = excluded.source_ip,
      host = excluded.host,
      destination_ip = excluded.destination_ip,
      destination_port = excluded.destination_port,
      network = excluded.network,
      process = excluded.process,
      inbound_user = excluded.inbound_user,
      inbound_name = excluded.inbound_name,
      rule = excluded.rule,
      rule_payload = excluded.rule_payload,
      outbound = excluded.outbound,
      chains_json = excluded.chains_json
  `)

  const closeConnectionStmt = database.prepare(`
    UPDATE connection_records
    SET end_time = ?
    WHERE connection_id = ? AND (end_time IS NULL OR end_time < ?)
  `)

  const addTrafficDeltaStmt = database.prepare(`
    INSERT INTO traffic_buckets (connection_id, bucket_time, upload, download)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(connection_id, bucket_time) DO UPDATE SET
      upload = upload + excluded.upload,
      download = download + excluded.download
  `)

  const setStateStmt = database.prepare(`
    INSERT INTO collector_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  const getStateStmt = database.prepare(
    'SELECT value FROM collector_state WHERE key = ?',
  )
  const setRealtimeStateStmt = database.prepare(`
    INSERT INTO realtime_state (key, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `)
  const getRealtimeStateStmt = database.prepare(
    'SELECT payload_json, updated_at FROM realtime_state WHERE key = ?',
  )
  const setConnectionsSnapshotStmt = database.prepare(`
    INSERT INTO connection_snapshot (id, payload_json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `)
  const getConnectionsSnapshotStmt = database.prepare(
    'SELECT payload_json, updated_at FROM connection_snapshot WHERE id = 1',
  )
  const addLogStmt = database.prepare(
    'INSERT INTO backend_logs (timestamp, type, payload) VALUES (?, ?, ?)',
  )
  const getLogsStmt = database.prepare(
    'SELECT seq, timestamp, type, payload FROM backend_logs ORDER BY seq DESC LIMIT ?',
  )

  function setState(key: string, value: string | number | boolean) {
    setStateStmt.run(key, String(value))
  }

  function getState(key: string, fallback = '') {
    return String((getStateStmt.get(key) as any)?.value ?? fallback)
  }

  function getRealtimeValue<T>(key: string) {
    const row = getRealtimeStateStmt.get(key) as any
    if (!row) return { data: null as T | null, updatedAt: 0 }
    try {
      return {
        data: JSON.parse(String(row.payload_json)) as T,
        updatedAt: Number(row.updated_at || 0),
      }
    } catch {
      return { data: null as T | null, updatedAt: Number(row.updated_at || 0) }
    }
  }

  return {
    upsertConnection(record) {
      upsertConnectionStmt.run(
        record.connectionId,
        record.startTime,
        record.endTime ?? null,
        record.sourceIP,
        record.host,
        record.destinationIP,
        record.destinationPort,
        record.network,
        record.process,
        record.inboundUser,
        record.inboundName,
        record.rule,
        record.rulePayload,
        record.outbound,
        JSON.stringify(record.chains),
      )
    },
    closeConnection(connectionId, endTime) {
      closeConnectionStmt.run(endTime, connectionId, endTime)
    },
    addTrafficDelta(delta) {
      if (delta.upload <= 0 && delta.download <= 0) return
      addTrafficDeltaStmt.run(
        delta.connectionId,
        delta.bucketTime,
        delta.upload,
        delta.download,
      )
      setState('lastWriteAt', delta.bucketTime)
    },
    setRealtimeTraffic(data, timestamp) {
      setRealtimeStateStmt.run('traffic', JSON.stringify(data), timestamp)
    },
    setRealtimeMemory(data, timestamp) {
      setRealtimeStateStmt.run('memory', JSON.stringify(data), timestamp)
    },
    getRealtimeState() {
      const traffic = getRealtimeValue<TrafficData>('traffic')
      const memory = getRealtimeValue<MemoryData>('memory')
      return {
        traffic: traffic.data,
        memory: memory.data,
        trafficUpdatedAt: traffic.updatedAt,
        memoryUpdatedAt: memory.updatedAt,
        connectionsUpdatedAt: Number(getState('connectionsUpdatedAt', '0')),
      }
    },
    setConnectionsSnapshot(snapshot, timestamp) {
      const normalizedSnapshot = {
        uploadTotal: snapshot?.uploadTotal || 0,
        downloadTotal: snapshot?.downloadTotal || 0,
        connections: snapshot?.connections || [],
      }
      setConnectionsSnapshotStmt.run(
        JSON.stringify(normalizedSnapshot),
        timestamp,
      )
      setState('connectionsUpdatedAt', timestamp)
    },
    getConnectionsSnapshot() {
      const row = getConnectionsSnapshotStmt.get() as any
      if (!row) return null
      try {
        const parsed = JSON.parse(String(row.payload_json))
        return {
          uploadTotal: Number(parsed.uploadTotal || 0),
          downloadTotal: Number(parsed.downloadTotal || 0),
          connections: parsed.connections || [],
          updatedAt: Number(row.updated_at || 0),
        }
      } catch {
        return null
      }
    },
    addLog(log, timestamp) {
      addLogStmt.run(timestamp, log.type, log.payload)
    },
    getLogs(limit) {
      const normalizedLimit = Math.min(
        Math.max(Math.trunc(limit || 100), 1),
        5000,
      )
      return getLogsStmt.all(normalizedLimit).map((row: any) => ({
        seq: Number(row.seq),
        timestamp: Number(row.timestamp),
        type: row.type,
        payload: String(row.payload),
      }))
    },
    cleanupBefore(beforeTime) {
      database
        .prepare('DELETE FROM traffic_buckets WHERE bucket_time < ?')
        .run(beforeTime)
      database
        .prepare('DELETE FROM backend_logs WHERE timestamp < ?')
        .run(beforeTime)
      database
        .prepare(
          `DELETE FROM connection_records
           WHERE connection_id NOT IN (
             SELECT DISTINCT connection_id FROM traffic_buckets
           )`,
        )
        .run()
    },
    getSummary(query) {
      const labelExpression = getDimensionExpression(query.dimension)
      const rows = database
        .prepare(
          `SELECT ${labelExpression} AS label,
                  SUM(tb.upload) AS upload,
                  SUM(tb.download) AS download,
                  SUM(tb.upload + tb.download) AS total,
                  COUNT(DISTINCT cr.connection_id) AS count
           FROM traffic_buckets tb
           JOIN connection_records cr ON cr.connection_id = tb.connection_id
           WHERE tb.bucket_time BETWEEN ? AND ?
           GROUP BY label
           HAVING total > 0
           ORDER BY total DESC`,
        )
        .all(query.startTime, query.endTime)
      return rowsToSummary(rows)
    },
    getDetails(query) {
      const parentExpression = getDimensionExpression(query.parentDimension)
      const detailExpression = getDimensionExpression(query.detailDimension)
      const rows = database
        .prepare(
          `SELECT ${detailExpression} AS label,
                  SUM(tb.upload) AS upload,
                  SUM(tb.download) AS download,
                  SUM(tb.upload + tb.download) AS total,
                  COUNT(DISTINCT cr.connection_id) AS count
           FROM traffic_buckets tb
           JOIN connection_records cr ON cr.connection_id = tb.connection_id
           WHERE tb.bucket_time BETWEEN ? AND ?
             AND ${parentExpression} = ?
           GROUP BY label
           HAVING total > 0
           ORDER BY total DESC`,
        )
        .all(query.startTime, query.endTime, query.parentLabel)
      return rowsToSummary(rows)
    },
    getTrend(query) {
      const bucketSize = normalizeBucketSize(query.bucketSizeMs)
      const labelExpression = getDimensionExpression(query.dimension)
      const filters = [
        'tb.bucket_time BETWEEN ? AND ?',
        query.label ? `${labelExpression} = ?` : '',
      ].filter(Boolean)
      const params = query.label
        ? [query.startTime, query.endTime, query.label]
        : [query.startTime, query.endTime]
      const rows = database
        .prepare(
          `SELECT (CAST(tb.bucket_time / ? AS INTEGER) * ?) AS timestamp,
                  SUM(tb.upload) AS upload,
                  SUM(tb.download) AS download
           FROM traffic_buckets tb
           JOIN connection_records cr ON cr.connection_id = tb.connection_id
           WHERE ${filters.join(' AND ')}
           GROUP BY timestamp
           ORDER BY timestamp ASC`,
        )
        .all(bucketSize, bucketSize, ...params) as any[]

      const values = new Map<number, TrafficTrendPoint>()
      for (const row of rows) {
        values.set(Number(row.timestamp), {
          timestamp: Number(row.timestamp),
          upload: Number(row.upload || 0),
          download: Number(row.download || 0),
        })
      }

      const trend: TrafficTrendPoint[] = []
      const firstBucket = normalizeBucketTime(query.startTime, bucketSize)
      const lastBucket = normalizeBucketTime(query.endTime, bucketSize)
      for (let t = firstBucket; t <= lastBucket; t += bucketSize) {
        trend.push(values.get(t) || { timestamp: t, upload: 0, download: 0 })
      }
      return trend
    },
    getStatus() {
      return {
        connected: getState('connected', 'false') === 'true',
        lastWriteAt: Number(getState('lastWriteAt', '0')),
        lastError: getState('lastError', ''),
      }
    },
    setCollectorStatus(status) {
      if (status.connected !== undefined)
        setState('connected', status.connected)
      if (status.lastWriteAt !== undefined)
        setState('lastWriteAt', status.lastWriteAt)
      if (status.lastError !== undefined)
        setState('lastError', status.lastError)
    },
    close() {
      database.close()
    },
  }
}
