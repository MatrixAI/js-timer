#!/usr/bin/env bash

set -euo pipefail

timeout --signal=TERM --kill-after=10 180 \
  ./node_modules/.bin/playwright test --config ./playwright.config.ts
