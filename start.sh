#!/bin/sh
set -e
eval "$BACKEND_CMD" &
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
