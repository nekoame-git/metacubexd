import { getTrafficService } from '../../utils/traffic/service'

export default defineEventHandler(() => {
  return getTrafficService().storage.getRealtimeState()
})
