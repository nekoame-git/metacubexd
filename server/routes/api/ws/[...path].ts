import { Buffer } from 'node:buffer'
import { createBackendWsUrl } from '../../../utils/backend'
import { isIgnorableSocketError } from '../../../utils/networkErrors'

const backendSockets = new WeakMap<object, WebSocket>()

function safePeerSend(peer: any, data: string | Buffer) {
  const ws = peer?._internal?.ws
  if (ws?.readyState === 1 && typeof ws.send === 'function') {
    ws.send(data, (error?: Error) => {
      if (error && !isIgnorableSocketError(error)) {
        console.error('[Backend WS] Failed to send to client', error)
      }
    })
    return
  }

  try {
    const result = peer.send(data)
    if (result && typeof result.catch === 'function') {
      result.catch((error: unknown) => {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPIPE' && code !== 'ECONNRESET') {
          console.error('[Backend WS] Failed to send to client', error)
        }
      })
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPIPE' && code !== 'ECONNRESET') {
      console.error('[Backend WS] Failed to send to client', error)
    }
    try {
      peer.close()
    } catch {
      // Ignore close errors from already-disconnected clients.
    }
  }
}

function safeBackendClose(ws: WebSocket | undefined) {
  try {
    ws?.close()
  } catch {
    // Ignore close errors from already-disconnected upstream sockets.
  }
}

export default defineWebSocketHandler({
  open(peer) {
    const rawPath = peer.request?.url
      ? new URL(peer.request.url, 'http://localhost').pathname
      : ''
    const path = rawPath.replace(/^\/api\/ws\/?/, '')
    const searchParams = peer.request?.url
      ? new URL(peer.request.url, 'http://localhost').searchParams
      : new URLSearchParams()
    const backendWs = new WebSocket(createBackendWsUrl(path, searchParams))

    backendWs.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        safePeerSend(peer, event.data)
      } else {
        safePeerSend(peer, Buffer.from(event.data as ArrayBuffer))
      }
    })
    backendWs.addEventListener('close', () => {
      try {
        peer.close()
      } catch {
        // Ignore close errors from already-disconnected clients.
      }
    })
    backendWs.addEventListener('error', () => {
      try {
        peer.close()
      } catch {
        // Ignore close errors from already-disconnected clients.
      }
    })

    backendSockets.set(peer, backendWs)
  },
  message(peer, message) {
    const backendWs = backendSockets.get(peer)
    if (backendWs?.readyState === WebSocket.OPEN) {
      try {
        backendWs.send(message.text())
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPIPE' && code !== 'ECONNRESET') {
          console.error('[Backend WS] Failed to send to upstream', error)
        }
      }
    }
  },
  close(peer) {
    const backendWs = backendSockets.get(peer)
    safeBackendClose(backendWs)
    backendSockets.delete(peer)
  },
})
