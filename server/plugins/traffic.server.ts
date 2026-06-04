import { startTrafficService } from '../utils/traffic/service'

export default defineNitroPlugin(() => {
  startTrafficService()
})
