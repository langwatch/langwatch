#!/bin/bash

# Script to run scenario archive E2E tests
# Usage: ./run-scenario-archive-tests.sh

set -e

echo "Running scenario archive E2E tests..."
echo "======================================"

cd "$(dirname "$0")"

# Check if app is running
if ! curl -s http://localhost:5570 > /dev/null 2>&1; then
  echo "ERROR: App is not running at http://localhost:5570"
  echo "Please start the app first:"
  echo "  cd ../langwatch"
  echo "  PORT=5570 pnpm dev"
  exit 1
fi

# Run the tests
pnpm playwright test tests/scenarios/scenario-archive.spec.ts

echo ""
echo "======================================"
echo "Tests completed!"
