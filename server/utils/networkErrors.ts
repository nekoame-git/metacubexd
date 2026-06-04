export function isIgnorableSocketError(error: unknown): boolean {
  if (!error) return false
  const socketError = error as NodeJS.ErrnoException & {
    cause?: unknown
    errors?: unknown[]
  }
  const code = socketError.code
  const message = socketError.message || String(error)
  if (
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    message.includes('write EPIPE') ||
    message.includes('ECONNRESET')
  ) {
    return true
  }
  if (socketError.cause && isIgnorableSocketError(socketError.cause)) {
    return true
  }
  if (Array.isArray(socketError.errors)) {
    return socketError.errors.some((item) => isIgnorableSocketError(item))
  }
  return false
}

export function catchIgnorableSocketError(result: unknown) {
  if (
    result &&
    typeof result === 'object' &&
    'catch' in result &&
    typeof result.catch === 'function'
  ) {
    result.catch((error: unknown) => {
      if (!isIgnorableSocketError(error)) {
        console.error('[Socket] Unhandled async socket error', error)
      }
    })
  }
}
