#!/usr/bin/env bash
# What the desktop shell serves: the web app (../dist) and the API bundled into one file (app/server.mjs).
set -euo pipefail
cd "$(dirname "$0")/.."
(cd .. && npm run build)
mkdir -p app
../node_modules/.bin/esbuild ../server/api.mjs --bundle --platform=node --format=esm --target=node22 --log-level=warning --outfile=app/server.mjs
echo "built ../dist and app/server.mjs"
