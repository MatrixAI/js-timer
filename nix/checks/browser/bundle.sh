#!/usr/bin/env bash

set -euo pipefail

npm run build
mkdir -p tmp/integration-browser/artifacts
./node_modules/.bin/esbuild dist/index.js \
  --bundle \
  --platform=browser \
  --format=iife \
  --global-name=libraryBundle \
  --target=es2022 \
  --outfile=tmp/integration-browser/browser.js \
  --metafile=tmp/integration-browser/artifacts/bundle-inputs.json
