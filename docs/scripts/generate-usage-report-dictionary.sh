#!/usr/bin/env bash
# Regenerates docs/self-hosting/usage-report-dictionary.mdx from the dictionary
# the install reports from (modules/ops/contract/src/usage-report.ts).
# Pass --check to exit 1 when the committed page is stale instead of writing.
#
# Run from the repo root. docs-ci runs it before diffing the generated files.
set -euo pipefail
cd "$(dirname "$0")/../../modules/ops/process"
pnpm exec tsx scripts/generate-usage-report-dictionary.ts "$@"
