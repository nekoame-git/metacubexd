import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOG_LEVEL } from '~/constants'
import {
  createTrafficStorage,
  normalizeBucketSize,
} from '../utils/traffic/storage'

const tempDirs: string[] = []

function createTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'metacubexd-traffic-'))
  tempDirs.push(dir)
  return join(dir, 'traffic.sqlite')
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('server traffic storage', () => {
  it('aggregates connection traffic by rule and trend bucket', () => {
    const storage = createTrafficStorage(createTempDbPath())

    storage.upsertConnection({
      connectionId: 'conn-1',
      startTime: 1_700_000_000_000,
      sourceIP: '10.0.0.2',
      host: 'example.com',
      destinationIP: '93.184.216.34',
      destinationPort: '443',
      network: 'tcp',
      process: 'curl',
      inboundUser: 'alice',
      inboundName: 'mixed',
      rule: 'DOMAIN-SUFFIX',
      rulePayload: 'example.com',
      outbound: 'ProxyA',
      chains: ['ProxyA', 'Fallback'],
    })
    storage.addTrafficDelta({
      connectionId: 'conn-1',
      bucketTime: 1_700_000_020_000,
      upload: 100,
      download: 900,
    })
    storage.addTrafficDelta({
      connectionId: 'conn-1',
      bucketTime: 1_700_000_030_000,
      upload: 50,
      download: 100,
    })

    expect(
      storage.getSummary({
        dimension: 'rule',
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_060_000,
      }),
    ).toEqual([
      {
        label: 'DOMAIN-SUFFIX example.com',
        upload: 150,
        download: 1000,
        total: 1150,
        count: 1,
      },
    ])

    expect(
      storage.getTrend({
        dimension: 'outbound',
        label: 'ProxyA',
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_120_000,
        bucketSizeMs: 60_000,
      }),
    ).toEqual([
      { timestamp: 1_699_999_980_000, upload: 150, download: 1000 },
      { timestamp: 1_700_000_040_000, upload: 0, download: 0 },
      { timestamp: 1_700_000_100_000, upload: 0, download: 0 },
    ])

    storage.close()
  })

  it('cleans expired buckets and orphaned connection records', () => {
    const storage = createTrafficStorage(createTempDbPath())

    storage.upsertConnection({
      connectionId: 'old',
      startTime: 1000,
      sourceIP: '10.0.0.2',
      host: 'old.example',
      destinationIP: '',
      destinationPort: '',
      network: 'tcp',
      process: 'curl',
      inboundUser: 'alice',
      inboundName: 'mixed',
      rule: 'MATCH',
      rulePayload: '',
      outbound: 'DIRECT',
      chains: ['DIRECT'],
    })
    storage.upsertConnection({
      connectionId: 'new',
      startTime: 2000,
      sourceIP: '10.0.0.3',
      host: 'new.example',
      destinationIP: '',
      destinationPort: '',
      network: 'tcp',
      process: 'curl',
      inboundUser: 'bob',
      inboundName: 'mixed',
      rule: 'MATCH',
      rulePayload: '',
      outbound: 'DIRECT',
      chains: ['DIRECT'],
    })
    storage.addTrafficDelta({
      connectionId: 'old',
      bucketTime: 1000,
      upload: 1,
      download: 1,
    })
    storage.addTrafficDelta({
      connectionId: 'new',
      bucketTime: 2000,
      upload: 2,
      download: 2,
    })

    storage.cleanupBefore(1500)

    expect(
      storage.getSummary({
        dimension: 'host',
        startTime: 0,
        endTime: 3000,
      }),
    ).toEqual([
      { label: 'new.example', upload: 2, download: 2, total: 4, count: 1 },
    ])

    storage.close()
  })

  it('normalizes unsupported trend buckets to one minute', () => {
    expect(normalizeBucketSize(1)).toBe(60_000)
    expect(normalizeBucketSize(60_000)).toBe(60_000)
    expect(normalizeBucketSize(300_000)).toBe(300_000)
  })

  it('persists latest realtime traffic and memory snapshots', () => {
    const storage = createTrafficStorage(createTempDbPath())

    storage.setRealtimeTraffic({ up: 12, down: 34 }, 1_700_000_000_000)
    storage.setRealtimeMemory({ inuse: 4096 }, 1_700_000_000_500)

    expect(storage.getRealtimeState()).toEqual({
      traffic: { up: 12, down: 34 },
      memory: { inuse: 4096 },
      trafficUpdatedAt: 1_700_000_000_000,
      memoryUpdatedAt: 1_700_000_000_500,
      connectionsUpdatedAt: 0,
    })

    storage.close()
  })

  it('persists current connection snapshots', () => {
    const storage = createTrafficStorage(createTempDbPath())

    storage.setConnectionsSnapshot(
      {
        uploadTotal: 100,
        downloadTotal: 200,
        connections: [
          {
            id: 'conn-1',
            upload: 10,
            download: 20,
            chains: ['ProxyA'],
            rule: 'MATCH',
            rulePayload: '',
            start: '2026-05-31T00:00:00.000Z',
            metadata: {
              network: 'tcp',
              type: 'HTTP',
              destinationIP: '93.184.216.34',
              destinationPort: '443',
              dnsMode: '',
              host: 'example.com',
              inboundIP: '',
              inboundName: 'mixed',
              inboundPort: '',
              inboundUser: 'alice',
              process: 'curl',
              processPath: '',
              remoteDestination: '',
              sniffHost: '',
              sourceIP: '10.0.0.2',
              sourcePort: '12345',
              specialProxy: '',
              specialRules: '',
              uid: 0,
            },
          },
        ],
      },
      1_700_000_001_000,
    )

    expect(storage.getConnectionsSnapshot()).toEqual({
      uploadTotal: 100,
      downloadTotal: 200,
      connections: [
        expect.objectContaining({
          id: 'conn-1',
          upload: 10,
          download: 20,
          rule: 'MATCH',
        }),
      ],
      updatedAt: 1_700_000_001_000,
    })

    storage.close()
  })

  it('persists and limits logs newest first', () => {
    const storage = createTrafficStorage(createTempDbPath())

    storage.addLog({ type: LOG_LEVEL.Info, payload: 'first' }, 1000)
    storage.addLog({ type: LOG_LEVEL.Warning, payload: 'second' }, 2000)

    expect(storage.getLogs(1)).toEqual([
      {
        seq: 2,
        timestamp: 2000,
        type: LOG_LEVEL.Warning,
        payload: 'second',
      },
    ])

    storage.close()
  })
})
