#!/usr/bin/env bash
#
# emit-otlp.sh — fake OTLP emitter for IngestionTemplate dogfood rituals.
#
# Posts a canned OTLP/HTTP traces payload to the LangWatch receiver with a
# UserIngestionBinding access token (ik-lw-*) as Bearer auth. Replaces the
# need to fire real upstream traffic (Anthropic 20x credits, Cursor agent
# runs, etc.) when exercising the per-template dogfood ritual.
#
# Two modes:
#
#   1. NORMAL — selects a per-template canned payload by slug:
#        ./emit-otlp.sh \
#          --binding-token ik-lw-xxxxx \
#          --template-id claude_code \
#          [--base-url http://localhost:5560] [--count 1]
#      Reads payloads/<template-id>.json (Ariana owns the canned shapes).
#
#   2. FORGE — selects a forge-attempt payload by category:
#        ./emit-otlp.sh \
#          --binding-token ik-lw-xxxxx \
#          --forge-attempt attribution
#      Reads payloads/forge-attempt/<category>.json. Each category claims
#      a different protected-key class (attribution / provenance) so the
#      receiver's principal-field guard can be regression-tested per
#      category without bespoke curl per-key.
#
# Optional --forge-tenant-id <id> works in EITHER mode; it injects (or
# overwrites) `langwatch.tenant_id` in the resource attributes so a single
# canned payload can be retargeted at any user's project for cross-user
# isolation testing.
#
# Output: stderr carries one human-readable status per request; stdout
# carries one trace-id per emitted span (or the receiver's response body
# when --verbose).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOADS_DIR="${SCRIPT_DIR}/payloads"

usage() {
  cat >&2 <<USAGE
Usage:
  $(basename "$0") --binding-token <ik-lw-*> [--template-id <slug> | --forge-attempt <category>]
                   [--base-url <url>] [--count <n>] [--forge-tenant-id <id>] [--verbose]

Required:
  --binding-token <ik-lw-*>      UserIngestionBinding access token (Bearer auth).
  --template-id <slug>          Use payloads/<slug>.json (NORMAL mode).
  --forge-attempt <category>    Use payloads/forge-attempt/<category>.json (FORGE mode).
                                One of --template-id or --forge-attempt is required.

Optional:
  --base-url <url>              LangWatch receiver base (default: http://localhost:5560).
  --count <n>                   Emit n distinct traces (default: 1).
  --forge-tenant-id <id>        Inject langwatch.tenant_id resource attr with this value.
  --verbose                     Print the receiver's response body on each request.
  -h, --help                    Show this help.

Dependencies: bash 4+, curl, jq, openssl (for trace/span ID generation).
USAGE
}

die() {
  printf '%s: %s\n' "$(basename "$0")" "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"
}

# Defaults.
BINDING_TOKEN=""
TEMPLATE_ID=""
FORGE_CATEGORY=""
BASE_URL="http://localhost:5560"
COUNT=1
FORGE_TENANT_ID=""
VERBOSE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binding-token)    BINDING_TOKEN="${2:-}"; shift 2 ;;
    --template-id)      TEMPLATE_ID="${2:-}"; shift 2 ;;
    --forge-attempt)    FORGE_CATEGORY="${2:-}"; shift 2 ;;
    --base-url)         BASE_URL="${2:-}"; shift 2 ;;
    --count)            COUNT="${2:-}"; shift 2 ;;
    --forge-tenant-id)  FORGE_TENANT_ID="${2:-}"; shift 2 ;;
    --verbose)          VERBOSE=1; shift ;;
    -h|--help)          usage; exit 0 ;;
    *)                  die "unknown flag: $1 (try --help)" ;;
  esac
done

[[ -n "$BINDING_TOKEN" ]] || { usage; die "--binding-token is required"; }
[[ "$BINDING_TOKEN" == ik-lw-* ]] || die "--binding-token must start with 'ik-lw-' (got prefix '${BINDING_TOKEN%%_*}_')"

if [[ -n "$TEMPLATE_ID" && -n "$FORGE_CATEGORY" ]]; then
  die "--template-id and --forge-attempt are mutually exclusive"
fi
if [[ -z "$TEMPLATE_ID" && -z "$FORGE_CATEGORY" ]]; then
  die "one of --template-id or --forge-attempt is required"
fi

[[ "$COUNT" =~ ^[0-9]+$ ]] || die "--count must be a non-negative integer (got: $COUNT)"
(( COUNT >= 1 )) || die "--count must be >= 1"

require_cmd curl
require_cmd jq
require_cmd openssl

if [[ -n "$TEMPLATE_ID" ]]; then
  PAYLOAD_FILE="${PAYLOADS_DIR}/${TEMPLATE_ID}.json"
  PAYLOAD_LABEL="template:${TEMPLATE_ID}"
else
  PAYLOAD_FILE="${PAYLOADS_DIR}/forge-attempt/${FORGE_CATEGORY}.json"
  PAYLOAD_LABEL="forge:${FORGE_CATEGORY}"
fi
[[ -f "$PAYLOAD_FILE" ]] || die "payload not found: ${PAYLOAD_FILE}
(canned payloads owned by Ariana — see scripts/dogfood/governance/payloads/README.md)"

ENDPOINT="${BASE_URL%/}/api/otel/v1/traces"

# Generate fresh trace+span IDs per request so the receiver doesn't dedupe
# across an N>1 burst. We replace any "traceId"/"spanId" string fields the
# canned payload happens to ship with — Ariana's payloads use placeholder
# values that the wrapper is expected to overwrite.
#
# Timestamps also get rewritten per-request (using `date +%s%N` for now-nanos)
# because the receiver drops spans whose start time is more than 31 days
# in the past. The canned payloads ship with frozen timestamps for
# determinism on the static fixture; we anchor them to current time at
# emit so the receiver doesn't 'success_no_collect' silently with
# rejectedSpans>0 (bug #77 root cause: 2024-05-08 timestamp + 31-day
# past cutoff = silent drop).
hex_id() {
  openssl rand -hex "$1"
}

# Best-effort nanosecond clock. Linux `date +%s%N` gives nanos directly;
# macOS `date` doesn't support %N, so fall back to seconds*1e9.
now_nanos() {
  local ns
  ns="$(date +%s%N 2>/dev/null)"
  if [[ "$ns" == *"N" ]] || [[ -z "$ns" ]]; then
    # macOS path — multiply seconds out, append zeros for nano resolution.
    printf '%s000000000\n' "$(date +%s)"
  else
    printf '%s\n' "$ns"
  fi
}

# Build the per-request body in four steps:
#   1. Load the canned payload as the base shape.
#   2. Overwrite traceId / spanId fields recursively (per-request uniqueness).
#   3. Overwrite startTimeUnixNano / endTimeUnixNano so the receiver's
#      31-day past cutoff doesn't silently drop the span.
#   4. If --forge-tenant-id, splice langwatch.tenant_id into the FIRST
#      resourceSpans[].resource.attributes — the principal-field guard at
#      the receiver should restore the binding-authoritative tenant_id
#      regardless of payload claim.
emit_one() {
  local trace_id span_id body start_ns end_ns
  trace_id="$(hex_id 16)"
  span_id="$(hex_id 8)"
  start_ns="$(now_nanos)"
  # 250ms span duration — arbitrary, just needs to be > 0 + close to start.
  end_ns="$((start_ns + 250000000))"

  body="$(jq \
    --arg traceId "$trace_id" \
    --arg spanId "$span_id" \
    --arg startNs "$start_ns" \
    --arg endNs "$end_ns" \
    --arg forgeTenant "$FORGE_TENANT_ID" '
      def replace_fields:
        if type == "object" then
          with_entries(
            if .key == "traceId" and (.value | type) == "string" then .value = $traceId
            elif .key == "spanId" and (.value | type) == "string" then .value = $spanId
            elif .key == "startTimeUnixNano" and (.value | type) == "string" then .value = $startNs
            elif .key == "endTimeUnixNano" and (.value | type) == "string" then .value = $endNs
            else .value |= replace_fields
            end
          )
        elif type == "array" then map(replace_fields)
        else .
        end;

      def maybe_inject_forge_tenant:
        if $forgeTenant == "" then .
        else
          .resourceSpans[0].resource.attributes |= (
            (map(select(.key != "langwatch.tenant_id"))) +
            [{ key: "langwatch.tenant_id", value: { stringValue: $forgeTenant } }]
          )
        end;

      replace_fields | maybe_inject_forge_tenant
    ' "$PAYLOAD_FILE")"

  local response status_code
  response="$(curl --silent --show-error --write-out '\n%{http_code}' \
    --request POST \
    --header "Authorization: Bearer ${BINDING_TOKEN}" \
    --header "Content-Type: application/json" \
    --data "$body" \
    "$ENDPOINT")"
  status_code="$(printf '%s' "$response" | tail -n 1)"
  local response_body
  response_body="$(printf '%s' "$response" | sed '$d')"

  if [[ "$status_code" =~ ^2 ]]; then
    # 2xx with rejectedSpans>0 is a SILENT-DROP — the receiver returns
    # success but the spans were dropped post-auth (validation, dedup,
    # past-cutoff, etc.). Surface the rejection count + errorMessage on
    # stderr so the dogfood ritual doesn't false-positive.
    local rejected=0
    local err_msg=""
    if command -v jq >/dev/null 2>&1; then
      rejected="$(printf '%s' "$response_body" | jq -r '.partialSuccess.rejectedSpans // 0' 2>/dev/null || printf '0')"
      err_msg="$(printf '%s' "$response_body" | jq -r '.partialSuccess.errorMessage // ""' 2>/dev/null || printf '')"
    fi
    if [[ "$rejected" != "0" ]]; then
      printf 'WARN %s — %s status=%s trace_id=%s rejected=%s error=%s\n' \
        "$ENDPOINT" "$PAYLOAD_LABEL" "$status_code" "$trace_id" "$rejected" "${err_msg:0:200}" >&2
    else
      printf 'ok %s — %s status=%s trace_id=%s\n' "$ENDPOINT" "$PAYLOAD_LABEL" "$status_code" "$trace_id" >&2
    fi
    printf '%s\n' "$trace_id"
  else
    printf 'fail %s — %s status=%s body=%s\n' "$ENDPOINT" "$PAYLOAD_LABEL" "$status_code" "${response_body:0:200}" >&2
    return 1
  fi

  if (( VERBOSE )); then
    printf '%s\n' "$response_body" >&2
  fi
}

for (( i = 0; i < COUNT; i++ )); do
  emit_one
done
