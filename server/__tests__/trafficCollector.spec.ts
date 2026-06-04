import type { TrafficStorage } from '../utils/traffic/storage'
import { describe, expect, it, vi } from 'vitest'
import { createTrafficCollectorCore } from '../utils/traffic/collector'

function createStorageMock() {
  return {
    upsertConnection: vi.fn(),
    closeConnection: vi.fn(),
    addTrafficDelta: vi.fn(),
    cleanupBefore: vi.fn(),
    getSummary: vi.fn(),
    getDetails: vi.fn(),
    getTrend: vi.fn(),
    getStatus: vi.fn(),
    setCollectorStatus: vi.fn(),
    close: vi.fn(),
  } satisfies TrafficStorage
}

function makeConnection(id: string, upload: number, download: number) {
  return {
    id,
    upload,
    download,
    chains: ['ProxyA', 'Fallback'],
    rule: 'DOMAIN-SUFFIX',
    rulePayload: 'example.com',
    start: '2026-05-31T00:00:00.000Z',
    metadata: {
      sourceIP: '10.0.0.2',
      host: 'example.com',
      destinationIP: '93.184.216.34',
      destinationPort: '443',
      network: 'tcp',
      process: 'curl',
      inboundUser: 'alice',
      inboundName: 'mixed',
    },
  }
}

describe('traffic collector core', () => {
  it('writes positive deltas and ignores websocket cumulative resets', () => {
    const storage = createStorageMock()
    const core = createTrafficCollectorCore(storage, () => 1_700_000_020_123)

    core.handleConnectionsMessage({
      uploadTotal: 1000,
      downloadTotal: 2000,
      connections: [makeConnection('conn-1', 100, 500)],
    })
    core.handleConnectionsMessage({
      uploadTotal: 1200,
      downloadTotal: 2600,
      connections: [makeConnection('conn-1', 150, 900)],
    })
    core.handleConnectionsMessage({
      uploadTotal: 10,
      downloadTotal: 20,
      connections: [makeConnection('conn-1', 1, 2)],
    })

    expect(storage.upsertConnection).toHaveBeenCalledTimes(3)
    expect(storage.addTrafficDelta).toHaveBeenCalledTimes(2)
    expect(storage.addTrafficDelta).toHaveBeenNthCalledWith(1, {
      connectionId: 'conn-1',
      bucketTime: 1_699_999_980_000,
      upload: 100,
      download: 500,
    })
    expect(storage.addTrafficDelta).toHaveBeenNthCalledWith(2, {
      connectionId: 'conn-1',
      bucketTime: 1_699_999_980_000,
      upload: 50,
      download: 400,
    })
  })

  it('marks connections closed when they disappear from active websocket data', () => {
    const storage = createStorageMock()
    const core = createTrafficCollectorCore(storage, () => 1_700_000_020_123)

    core.handleConnectionsMessage({
      uploadTotal: 1000,
      downloadTotal: 2000,
      connections: [makeConnection('conn-1', 100, 500)],
    })
    core.handleConnectionsMessage({
      uploadTotal: 1100,
      downloadTotal: 2100,
      connections: [],
    })

    expect(storage.closeConnection).toHaveBeenCalledWith(
      'conn-1',
      1_700_000_020_123,
    )
  })
})
