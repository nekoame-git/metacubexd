import type { TrafficDimension } from '../../utils/traffic/types'
import { getTrafficService } from '../../utils/traffic/service'

function readNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const endTime = readNumber(query.end, Date.now())
  const startTime = readNumber(query.start, endTime - 60 * 60 * 1000)
  const bucketSizeMs = readNumber(query.bucketMs, 60_000)
  return getTrafficService().storage.getTrend({
    dimension: (query.dimension as TrafficDimension) || 'sourceIP',
    label: typeof query.label === 'string' ? query.label : undefined,
    startTime,
    endTime,
    bucketSizeMs,
  })
})
