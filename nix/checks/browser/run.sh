#!/usr/bin/env bash

set -euo pipefail

if [ -n "${CHECK_PLAYWRIGHT_VERSION:-}" ]; then
  npm_playwright_version="$(node -p "require('./node_modules/@playwright/test/package.json').version")"
  if [ "$npm_playwright_version" != "$CHECK_PLAYWRIGHT_VERSION" ]; then
    printf 'Playwright version mismatch: npm=%s Nix=%s\n' \
      "$npm_playwright_version" "$CHECK_PLAYWRIGHT_VERSION" >&2
    exit 1
  fi
fi

timeout --signal=TERM --kill-after=10 180 \
  ./node_modules/.bin/playwright test --config ./playwright.config.ts
