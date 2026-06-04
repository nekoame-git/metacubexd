import type { TrafficDimension } from '../../utils/traffic/types'
import { getTrafficService } from '../../utils/traffic/service'

const DEFAULT_DIMENSION: TrafficDimension = 'sourceIP'

function readNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const endTime = readNumber(query.end, Date.now())
  const startTime = readNumber(query.start, endTime - 60 * 60 * 1000)
  return getTrafficService().storage.getSummary({
    dimension: (query.dimension as TrafficDimension) || DEFAULT_DIMENSION,
    startTime,
    endTime,
  })
})
