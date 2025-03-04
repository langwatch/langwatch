#!/bin/bash

set -eo pipefail

if [ "$OS" = "Windows_NT" ]; then
  echo "Windows detected"
  npm run start:prepare:files && npm run build:websocket && set NODE_ENV=development && npm run start
else
  npm run start:prepare:files && npm run build:websocket && NODE_ENV=development npm run start
fi