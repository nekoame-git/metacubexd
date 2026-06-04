import { getQuery } from 'h3'
import { getTrafficService } from '../../utils/traffic/service'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = Number(query.limit || 1000)
  return getTrafficService().storage.getLogs(limit)
})
