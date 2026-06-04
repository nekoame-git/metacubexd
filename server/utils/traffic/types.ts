import type {
  ConnectionRawMessage as ClientConnectionRawMessage,
  DataUsageType,
  Log,
  MemoryData,
  TrafficData,
} from '~/types'

export type TrafficDimension = DataUsageType | 'rule'

export interface BackendRuntimeConfig {
  backendUrl: string
  backendSecret: string
  trafficEnabled: boolean
  trafficDbPath: string
  trafficRetentionDays: number
}

export interface TrafficConnectionRecord {
  connectionId: string
  startTime: number
  endTime?: number
  sourceIP: string
  host: string
  destinationIP: string
  destinationPort: string
  network: string
  process: string
  inboundUser: string
  inboundName: string
  rule: string
  rulePayload: string
  outbound: string
  chains: string[]
}

export interface TrafficDelta {
  connectionId: string
  bucketTime: number
  upload: number
  download: number
}

export interface TrafficSummaryQuery {
  dimension: TrafficDimension
  startTime: number
  endTime: number
}

export interface TrafficDetailsQuery extends TrafficSummaryQuery {
  parentDimension: TrafficDimension
  parentLabel: string
  detailDimension: TrafficDimension
}

export interface TrafficTrendQuery extends TrafficSummaryQuery {
  label?: string
  bucketSizeMs: number
}

export interface TrafficSummaryRow {
  label: string
  upload: number
  download: number
  total: number
  count: number
}

export interface TrafficTrendPoint {
  timestamp: number
  upload: number
  download: number
}

export interface TrafficCollectorStatus {
  enabled: boolean
  connected: boolean
  backendUrl: string
  dbPath: string
  retentionDays: number
  lastWriteAt: number
  lastError: string
}

export type ConnectionsMessage = {
  connections?: ClientConnectionRawMessage[]
  uploadTotal: number
  downloadTotal: number
} | null

export type ConnectionRawMessage = ClientConnectionRawMessage

export interface RealtimeStateSnapshot {
  traffic: TrafficData | null
  memory: MemoryData | null
  trafficUpdatedAt: number
  memoryUpdatedAt: number
  connectionsUpdatedAt: number
}

export type ConnectionsSnapshot = {
  connections?: ClientConnectionRawMessage[]
  uploadTotal: number
  downloadTotal: number
  updatedAt: number
} | null

export type StoredLog = Log & {
  seq: number
  timestamp: number
}
