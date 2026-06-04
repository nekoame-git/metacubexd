import {
  createBackendHeaders,
  createBackendHttpUrl,
  isBackendStreamingPath,
} from '../../utils/backend'

export default defineEventHandler(async (event) => {
  const path = event.context.params?.path || ''
  if (isBackendStreamingPath(path)) {
    throw createError({
      statusCode: 400,
      statusMessage: `/${path.replace(/^\/+/, '')} is a streaming endpoint; use /api/traffic stored APIs instead`,
    })
  }

  const url = createBackendHttpUrl(path, getRequestURL(event).search)
  const method = event.method
  const headers = createBackendHeaders(getRequestHeaders(event) as HeadersInit)
  const body = ['GET', 'HEAD'].includes(method)
    ? undefined
    : await readRawBody(event)

  const response = await fetch(url, {
    method,
    headers,
    body,
  })

  setResponseStatus(event, response.status, response.statusText)
  response.headers.forEach((value, key) => {
    if (
      ![
        'connection',
        'content-encoding',
        'content-length',
        'transfer-encoding',
      ].includes(key.toLowerCase())
    ) {
      setResponseHeader(event, key, value)
    }
  })

  if (response.status === 204) return null
  const arrayBuffer = await response.arrayBuffer()
  return new Uint8Array(arrayBuffer)
})
