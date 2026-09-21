#!/bin/bash
# Resolve the NLP engine address the app is going to dial, so `pnpm dev` starts
# its engine on that port instead of one nothing talks to.
#
# The reading itself is generic and lives in resolve-service-address.sh; this
# names the variable and the label for the engine. See that file for why the
# launcher has to read the env files at all.
#
# Usage from platform/app/scripts/start.sh:
#
#   . "$(dirname "$0")/../../../dev/scripts/lib/resolve-nlp-service.sh"
#   resolve_nlp_service "$(dirname "$0")/.."

. "$(dirname "${BASH_SOURCE[0]}")/resolve-service-address.sh"

resolve_nlp_service() {
  resolve_service_address LANGWATCH_NLP_SERVICE "${1:-.}" nlpgo
}
