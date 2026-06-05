#!/bin/sh

set -eu

# Map DEFAULT_BACKEND_URL to Nuxt runtime config env vars.
# Nitro embeds public asset metadata at build time, so do not rewrite config.js.
export NUXT_PUBLIC_DEFAULT_BACKEND_URL="${DEFAULT_BACKEND_URL:-}"
export METACUBEXD_BACKEND_URL="${METACUBEXD_BACKEND_URL:-${DEFAULT_BACKEND_URL:-}}"

# Enable same-origin /api/backend + /api/traffic for all clients (LAN and remote tunnel).
# serverBackendMode is evaluated at image build time without these env vars; override at runtime.
if [ -n "${METACUBEXD_BACKEND_URL}" ]; then
  export NUXT_PUBLIC_SERVER_BACKEND_MODE=true
fi

# Start Node.js server
exec node /app/.output/server/index.mjs
