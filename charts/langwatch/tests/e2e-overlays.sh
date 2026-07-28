#!/usr/bin/env bash
# E2E tests for the overlay values system.
#
# Validates that every overlay combination renders correctly and that key
# overlay combos produce the expected Kubernetes resources when installed.
#
# Requirements: kind, helm, kubectl, docker
# Environment:
#   KEEP_CLUSTER=true  — skip Kind cluster deletion on exit
#   CLUSTER_NAME       — Kind cluster name (default: lw-overlay)
#   TIMEOUT            — helm --wait timeout in seconds (default: 300)

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-lw-overlay}"
RELEASE="lw"
NAMESPACE="lw-test"
CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMEOUT="${TIMEOUT:-300}"
OVERLAYS="${CHART_DIR}/examples/overlays"

# Source shared helpers
# shellcheck source=../../lib/test-helpers.sh
source "$(cd "$(dirname "$0")/../../lib" && pwd)/test-helpers.sh"

trap cleanup_cluster EXIT

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Render templates and capture output (no cluster needed)
tmpl() {
  helm template "$RELEASE" "$CHART_DIR" "$@" 2>&1
}

# Render only a single template (no cluster needed) — scopes assertions to one
# resource so env vars set on other deployments (workers/nlp also set
# LANGWATCH_ENDPOINT) can't mask a missing one on the app deployment.
tmpl_only() {
  local only="$1"; shift
  helm template "$RELEASE" "$CHART_DIR" --show-only "$only" "$@" 2>&1
}

# Check rendered YAML contains a string (uses <<< to avoid broken pipe with large output)
assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if grep -qF "$needle" <<< "$haystack"; then
    pass "$label"
  else
    fail "$label: expected to find '$needle'"
  fi
}

# Check rendered YAML does NOT contain a string
assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if grep -qF "$needle" <<< "$haystack"; then
    fail "$label: expected NOT to find '$needle'"
  else
    pass "$label"
  fi
}

# Count occurrences of a pattern in rendered YAML
count_matches() {
  local haystack="$1" pattern="$2"
  grep -c "$pattern" <<< "$haystack" || echo "0"
}

# Render with the standard prod+ingress overlays. Extra helm args are appended,
# so a caller can override ingress.* per case.
tmpl_ingress() {
  tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" "$@"
}

# Assert the chart REFUSES to render, and refuses for the stated reason.
# Both halves matter: any template error trips a bare exit-code check, so a
# rc-only assertion would go green for an unrelated breakage.
# `out=$(...) && rc=0 || rc=$?` keeps helm's status without a `set -e` abort.
assert_render_refuses() {
  local label="$1" reason="$2"; shift 2
  local out rc
  out=$(tmpl_ingress "$@") && rc=0 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    fail "$label: expected helm to refuse, got exit 0"
  elif ! grep -qF "$reason" <<< "$out"; then
    fail "$label: refused, but not for the expected reason (wanted '$reason')"
  else
    pass "$label"
  fi
}

# Assert the chart renders cleanly — the negative control for the guards above.
assert_render_succeeds() {
  local label="$1"; shift
  local out rc
  out=$(tmpl_ingress "$@") && rc=0 || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    pass "$label"
  else
    fail "$label: helm exited ${rc} :: $(head -3 <<< "$out")"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Template rendering — every overlay combo renders without error
# ─────────────────────────────────────────────────────────────────────────────
test_template_rendering() {
  sep; info "Suite: template rendering (all overlay combos)"

  local combos=(
    "size-minimal + nodeport"
    "size-dev + nodeport"
    "size-prod + ingress"
    "size-ha + ingress"
    "size-dev + nodeport + local-images"
    "size-prod + ingress + clickhouse-external"
    "size-prod + ingress + clickhouse-replicated"
    "size-prod + ingress + postgres-external"
    "size-prod + ingress + redis-external"
    "size-prod + ingress + postgres-external + redis-external"
    "size-ha + ingress + clickhouse-replicated + cold-storage-s3"
    "size-ha + ingress + postgres-external + redis-external + cold-storage-s3"
  )

  local flags_map
  declare -A flags_map=(
    ["size-minimal + nodeport"]="-f ${OVERLAYS}/size-minimal.yaml -f ${OVERLAYS}/access-nodeport.yaml"
    ["size-dev + nodeport"]="-f ${OVERLAYS}/size-dev.yaml -f ${OVERLAYS}/access-nodeport.yaml"
    ["size-prod + ingress"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml"
    ["size-ha + ingress"]="-f ${OVERLAYS}/size-ha.yaml -f ${OVERLAYS}/access-ingress.yaml"
    ["size-dev + nodeport + local-images"]="-f ${OVERLAYS}/size-dev.yaml -f ${OVERLAYS}/access-nodeport.yaml -f ${OVERLAYS}/local-images.yaml"
    ["size-prod + ingress + clickhouse-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/clickhouse-external.yaml"
    ["size-prod + ingress + clickhouse-replicated"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/clickhouse-replicated.yaml"
    ["size-prod + ingress + postgres-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/postgres-external.yaml"
    ["size-prod + ingress + redis-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/redis-external.yaml"
    ["size-prod + ingress + postgres-external + redis-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/postgres-external.yaml -f ${OVERLAYS}/redis-external.yaml"
    ["size-ha + ingress + clickhouse-replicated + cold-storage-s3"]="-f ${OVERLAYS}/size-ha.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/clickhouse-replicated.yaml -f ${OVERLAYS}/cold-storage-s3.yaml --set clickhouse.objectStorage.bucket=test --set clickhouse.objectStorage.region=us-east-1"
    ["size-ha + ingress + postgres-external + redis-external + cold-storage-s3"]="-f ${OVERLAYS}/size-ha.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/postgres-external.yaml -f ${OVERLAYS}/redis-external.yaml -f ${OVERLAYS}/cold-storage-s3.yaml --set clickhouse.objectStorage.bucket=test --set clickhouse.objectStorage.region=us-east-1"
  )

  for combo in "${combos[@]}"; do
    local flags="${flags_map[$combo]}"
    # shellcheck disable=SC2086
    if tmpl --set autogen.enabled=true $flags > /dev/null; then
      pass "renders: $combo"
    else
      fail "render failed: $combo"
    fi
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Profile rendering — all-in-one profiles render without error
# ─────────────────────────────────────────────────────────────────────────────
test_profile_rendering() {
  sep; info "Suite: profile rendering"

  tmpl -f "${CHART_DIR}/examples/values-local.yaml" > /dev/null \
    && pass "renders: values-local.yaml" \
    || fail "render failed: values-local.yaml"

  tmpl -f "${CHART_DIR}/examples/values-hosted-prod.yaml" > /dev/null \
    && pass "renders: values-hosted-prod.yaml" \
    || fail "render failed: values-hosted-prod.yaml"

  tmpl -f "${CHART_DIR}/examples/values-scalable-prod.yaml" > /dev/null \
    && pass "renders: values-scalable-prod.yaml" \
    || fail "render failed: values-scalable-prod.yaml"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: access-nodeport — verify NodePort service and correct URLs
# ─────────────────────────────────────────────────────────────────────────────
test_access_nodeport() {
  sep; info "Suite: access-nodeport overlay"

  local out
  out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml")

  # Service type = NodePort
  assert_contains "Service type is NodePort" "$out" "type: NodePort"
  assert_contains "NodePort is 30560" "$out" "nodePort: 30560"

  # NEXTAUTH_URL uses port 30560
  assert_contains "NEXTAUTH_URL uses 30560" "$out" "http://localhost:30560"

  # No Ingress resource
  assert_not_contains "No Ingress created" "$out" "kind: Ingress"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: access-ingress — verify Ingress, TLS, and no NodePort
# ─────────────────────────────────────────────────────────────────────────────
test_access_ingress() {
  sep; info "Suite: access-ingress overlay"

  # Capture the exit code rather than letting `set -e` kill the assignment: a
  # render failure here would otherwise abort the whole suite before a single
  # [PASS]/[FAIL] line printed, leaving CI with a bare non-zero exit and no clue
  # which assertion was in flight.
  local out rc
  out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml") && rc=0 || rc=$?
  [[ "$rc" -eq 0 ]] || fail "prod+ingress render failed: $(head -3 <<< "$out")"

  # Ingress resource created
  assert_contains "Ingress created" "$out" "kind: Ingress"
  assert_contains "Ingress class is nginx" "$out" "ingressClassName: nginx"
  assert_contains "TLS secret configured" "$out" "secretName: langwatch-tls"
  assert_contains "Ingress host set" "$out" "langwatch.example.com"

  # Backend auto-wired to app service
  assert_contains "Backend → lw-app" "$out" "name: ${RELEASE}-app"

  # Service type = ClusterIP (default, not NodePort)
  assert_not_contains "No NodePort" "$out" "type: NodePort"

  # /api/internal is hard-blocked at the edge by default: the ingress renders a
  # higher-priority Prefix path for it, routing to a no-endpoints blackhole
  # Service so the private control-plane surface (langy-internal / langy-relay /
  # gateway-internal) is never internet-reachable. Regression for the
  # "internal routes reachable via default ingress" finding.
  local ingress_only ingress_rc
  ingress_only=$(tmpl_only "templates/ingress.yaml" --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml") && ingress_rc=0 || ingress_rc=$?
  # An empty --show-only render is the regression this block exists to catch, and
  # under `set -euo pipefail` a bare assignment would abort the suite with no
  # output at all — so check the exit code before asserting on the content.
  [[ "$ingress_rc" -eq 0 ]] || fail "ingress.yaml did not render: $(head -3 <<< "$ingress_only")"
  assert_contains "Ingress blocks /api/internal path" "$ingress_only" 'path: "/api/internal"'
  assert_contains "Blocked path → blackhole Service" "$ingress_only" "name: ${RELEASE}-blackhole"
  # pathType is load-bearing and was previously unasserted: flipping the blocked
  # path to `Exact` blocks only the literal `/api/internal` and lets every real
  # route (/api/internal/langy/*, /api/internal/gateway/*) fall through to the
  # app's catch-all — a total bypass that leaves every other assertion green.
  if grep -A1 -F 'path: "/api/internal"' <<< "$ingress_only" | grep -qF "pathType: Prefix"; then
    pass "Blocked path is a Prefix match"
  else
    fail "Blocked path must render pathType: Prefix (Exact would block only the literal path)"
  fi
  # Longest-match is what carries the block; emitting first is a hedge for
  # controllers that derive rule priority from list position (AWS load balancer
  # controller) rather than match length. Assert the ordering so that hedge
  # cannot be dropped silently.
  # `|| true` on both: under `set -euo pipefail` a non-matching grep aborts the
  # whole suite at the assignment, so the `fail` diagnostic below (and its
  # `${app_line:-?}` fallback) would never print for the regression it exists to
  # catch — e.g. the app path rendering as `path: "/"` after a quoting change.
  local api_internal_line app_line
  api_internal_line=$(grep -nF 'path: "/api/internal"' <<< "$ingress_only" | head -1 | cut -d: -f1 || true)
  app_line=$(grep -nE 'path: "?/"?$' <<< "$ingress_only" | head -1 | cut -d: -f1 || true)
  if [[ -n "$api_internal_line" && -n "$app_line" && "$api_internal_line" -lt "$app_line" ]]; then
    pass "Blocked path listed before app catch-all"
  else
    fail "Blocked path should precede app catch-all (/api/internal@${api_internal_line:-?}, /@${app_line:-?})"
  fi

  # The ordering hedge exists for the DEFAULT topology, whose catch-all ships as
  # `pathType: ImplementationSpecific` — every other case here overrides
  # ingress.hosts with `Prefix`, so without this the shipped shape is untested.
  local default_hosts
  default_hosts=$(tmpl_only "templates/ingress.yaml" --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" --set ingress.enabled=true) && ingress_rc=0 || ingress_rc=$?
  [[ "$ingress_rc" -eq 0 ]] || fail "default-hosts ingress did not render"
  assert_contains "Default hosts still block /api/internal" "$default_hosts" 'path: "/api/internal"'
  assert_contains "Default catch-all is ImplementationSpecific" "$default_hosts" "pathType: ImplementationSpecific"

  # Every prefix in the list is blocked, and every host gets the block. Both
  # loops have been narrowed by refactors before (honouring only blockedPaths[0]
  # or hosts[0]), and a single-host/single-prefix suite cannot see either.
  local multi
  multi=$(tmpl_ingress --set-json 'ingress.blockedPaths=["/api/internal","/api/cron"]') \
    && ingress_rc=0 || ingress_rc=$?
  [[ "$ingress_rc" -eq 0 ]] || fail "multi-prefix ingress did not render"
  assert_contains "Second blocked prefix rendered" "$multi" 'path: "/api/cron"'
  assert_contains "First blocked prefix still rendered" "$multi" 'path: "/api/internal"'
  assert_render_refuses "Nested path on a SECOND host is caught" \
    "would out-match the blackhole" \
    --set-json 'ingress.hosts=[{"host":"a.example.com","http":{"paths":[{"path":"/","pathType":"Prefix"}]}},{"host":"b.example.com","http":{"paths":[{"path":"/api/internal/status","pathType":"Prefix"}]}}]'

  # The blackhole Service renders with no selector, which is what makes it a
  # dead end: nothing populates its Endpoints, so the controller has nowhere to
  # forward a blocked request.
  local blackhole_svc blackhole_rc
  blackhole_svc=$(tmpl_only "templates/blackhole-service.yaml" --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml") && blackhole_rc=0 || blackhole_rc=$?
  [[ "$blackhole_rc" -eq 0 ]] || fail "blackhole-service.yaml did not render: $(head -3 <<< "$blackhole_svc")"
  assert_contains "Blackhole Service rendered" "$blackhole_svc" "name: ${RELEASE}-blackhole"
  assert_not_contains "Blackhole Service has no selector" "$blackhole_svc" "selector:"
  # Operator labels are merged as a dict, not appended as text: a colliding key
  # would otherwise be emitted twice, and kubectl rejects duplicate mapping keys.
  local dup_labels
  dup_labels=$(tmpl_only "templates/blackhole-service.yaml" --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    --set-json 'ingress.labels={"app.kubernetes.io/component":"custom"}')
  if [[ "$(grep -c "app.kubernetes.io/component: " <<< "$dup_labels")" -eq 1 ]]; then
    pass "Colliding ingress.labels key emitted once"
  else
    fail "ingress.labels collision produced a duplicate mapping key"
  fi

  # Operators can disable the block by emptying blockedPaths.
  # --set-json, NOT --set: `--set 'x=[]'` assigns the two-character STRING "[]",
  # which is truthy (so the blackhole Service still renders) and then blows up
  # the ingress template with "range can't iterate over []". Only --set-json
  # produces a real empty list — the same value an operator writing
  # `blockedPaths: []` in a values file gets.
  local no_block
  no_block=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    --set-json 'ingress.blockedPaths=[]')
  assert_not_contains "blockedPaths=[] drops the block" "$no_block" "${RELEASE}-blackhole"
  # …and the path itself is gone, not merely re-pointed: a blocked path left in
  # the ingress while the blackhole Service disappears would route to a
  # nonexistent backend, which the Service-name assertion alone would miss.
  assert_not_contains "blockedPaths=[] removes blocked path" "$no_block" 'path: "/api/internal"'

  # An application path nested under a blocked prefix out-matches the blackhole
  # and routes the private control plane straight to the app — the block is
  # still rendered, so nothing looks wrong, but it no longer blocks. The chart
  # refuses to render that combination rather than ship a silent bypass.
  assert_render_refuses "Nested app path under a blocked prefix refuses to render" \
    "would out-match the blackhole" \
    --set-json 'ingress.hosts=[{"host":"lw.example.com","http":{"paths":[{"path":"/api/internal/status","pathType":"Prefix"},{"path":"/","pathType":"ImplementationSpecific"}]}}]'

  # An app path equal to the blocked prefix is the same bypass without the
  # nesting, and the guard's equality arm has to catch it.
  assert_render_refuses "App path equal to a blocked prefix refuses to render" \
    "would out-match the blackhole" \
    --set-json 'ingress.hosts=[{"host":"lw.example.com","http":{"paths":[{"path":"/api/internal","pathType":"Prefix"}]}}]'

  # Malformed prefixes degrade the block into decoration rather than breaking
  # loudly, so each is rejected by name. Without normalisation a trailing slash
  # makes the guard's segment test build "/api/internal//", which matches
  # nothing — the nested path below then renders and out-matches the blackhole.
  assert_render_refuses "Trailing-slash prefix still catches a nested path" \
    "would out-match the blackhole" \
    --set-json 'ingress.blockedPaths=["/api/internal/"]' \
    --set-json 'ingress.hosts=[{"host":"lw.example.com","http":{"paths":[{"path":"/api/internal/status","pathType":"Prefix"}]}}]'
  assert_render_refuses "Prefix without a leading slash is rejected" \
    "must be an absolute path" \
    --set-json 'ingress.blockedPaths=["api/internal"]'
  assert_render_refuses "A bare / prefix is rejected" \
    "would route the whole site to the blackhole" \
    --set-json 'ingress.blockedPaths=["/"]'
  # `--set 'x=[]'` assigns the two-character STRING "[]", which is truthy — the
  # block half-renders. Rejected by name, because this is the spelling an
  # operator reaches for when disabling the block under pressure.
  assert_render_refuses "Non-list blockedPaths is rejected by name" \
    "must be a list" \
    --set 'ingress.blockedPaths=[]'

  # …but the guard matches on `/`-separated segments, exactly like
  # `pathType: Prefix`. `/api/internal-status` is a sibling, NOT nested: the
  # block does not cover it, so rejecting it would break a legitimate app path.
  # A naive `hasPrefix` guard passes every assertion above and fails this one.
  local sibling_out sibling_rc
  sibling_out=$(tmpl_ingress \
    --set-json 'ingress.hosts=[{"host":"lw.example.com","http":{"paths":[{"path":"/api/internal-status","pathType":"Prefix"},{"path":"/","pathType":"ImplementationSpecific"}]}}]') \
    && sibling_rc=0 || sibling_rc=$?
  if [[ "$sibling_rc" -eq 0 ]]; then
    pass "Sibling path outside the blocked prefix still renders"
  else
    fail "Sibling path /api/internal-status should render (helm exited ${sibling_rc})"
  fi
  # Anchor on the backend too — the label claims it reaches the app, so assert
  # that rather than the path string alone.
  if grep -A4 -F "path: /api/internal-status" <<< "$sibling_out" | grep -qF "name: ${RELEASE}-app"; then
    pass "Sibling path routed to the app"
  else
    fail "Sibling path /api/internal-status should route to ${RELEASE}-app"
  fi

  # Emptying blockedPaths opts out of the guard too, so an operator who
  # knowingly disables the block is not held up by a path it no longer covers.
  assert_render_succeeds "blockedPaths=[] disables the guard along with the block" \
    --set-json 'ingress.blockedPaths=[]' \
    --set-json 'ingress.hosts=[{"host":"lw.example.com","http":{"paths":[{"path":"/api/internal/status","pathType":"Prefix"}]}}]'
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: LANGWATCH_ENDPOINT — the app deployment sets its own internal
# platform-API callback URL so post-#3541 images (which boot-validate
# LANGWATCH_ENDPOINT as a required URL) don't crash-loop on chart defaults.
# Regression for #5659.
# ─────────────────────────────────────────────────────────────────────────────
test_langwatch_endpoint() {
  sep; info "Suite: LANGWATCH_ENDPOINT on app deployment (#5659)"

  # Default render: env present, self-referencing localhost on the app port.
  # Assert the value on the LANGWATCH_ENDPOINT line itself — grepping the whole
  # render for "http://localhost:5560" would pass off BASE_HOST / NEXTAUTH_URL*,
  # which render the same value, and miss a wrong LANGWATCH_ENDPOINT value.
  local ep_default
  ep_default=$(tmpl_only "templates/app/deployment.yaml" --set autogen.enabled=true \
    | grep -A1 "name: LANGWATCH_ENDPOINT")
  assert_contains "app sets LANGWATCH_ENDPOINT" "$ep_default" "name: LANGWATCH_ENDPOINT"
  assert_contains "LANGWATCH_ENDPOINT self-references localhost:5560" \
    "$ep_default" "http://localhost:5560"

  # Override via values is honored (on the LANGWATCH_ENDPOINT line).
  local ep_override
  ep_override=$(tmpl_only "templates/app/deployment.yaml" \
    --set autogen.enabled=true \
    --set app.http.langwatchEndpoint=https://collector.example.com \
    | grep -A1 "name: LANGWATCH_ENDPOINT")
  assert_contains "LANGWATCH_ENDPOINT override honored" \
    "$ep_override" "https://collector.example.com"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: backup metrics gate — CLICKHOUSE_BACKUP_METRICS_ENABLED must follow the
# backup config so the "Backup Reporting Absent" signal cannot silently drift
# from whether backups actually run (PR #5814).
# ─────────────────────────────────────────────────────────────────────────────
test_backup_metrics_gate() {
  sep; info "Suite: CLICKHOUSE_BACKUP_METRICS_ENABLED gate follows backup config"

  local backup_flags="--set autogen.enabled=true --set clickhouse.objectStorage.bucket=b --set clickhouse.objectStorage.region=us-east-1"

  # Off by default: no backups configured -> no backup-log querying.
  local off
  off=$(tmpl_only "templates/workers/deployment.yaml" --set autogen.enabled=true)
  assert_not_contains "default: workers do not set backup metrics" \
    "$off" "CLICKHOUSE_BACKUP_METRICS_ENABLED"

  # Chart-managed backups on -> metrics auto-enabled on the workers (which emit
  # the gauges), so the alert never fires spuriously against a live backup setup.
  local on
  # shellcheck disable=SC2086
  on=$(tmpl_only "templates/workers/deployment.yaml" $backup_flags --set clickhouse.backup.enabled=true \
    | grep -A1 "name: CLICKHOUSE_BACKUP_METRICS_ENABLED")
  assert_contains "backup.enabled: workers set backup metrics" \
    "$on" "name: CLICKHOUSE_BACKUP_METRICS_ENABLED"
  assert_contains "backup.enabled: backup metrics value true" "$on" '"true"'

  # Explicit override for out-of-band backups (backups run elsewhere, but we
  # still want the signal).
  local forced
  forced=$(tmpl_only "templates/workers/deployment.yaml" --set autogen.enabled=true \
    --set clickhouse.backup.metricsEnabled=true \
    | grep -A1 "name: CLICKHOUSE_BACKUP_METRICS_ENABLED")
  assert_contains "metricsEnabled override: workers set backup metrics" \
    "$forced" "name: CLICKHOUSE_BACKUP_METRICS_ENABLED"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: size overlays — verify replica counts and resource sizing
# ─────────────────────────────────────────────────────────────────────────────
test_size_overlays() {
  sep; info "Suite: size overlays"

  # size-minimal: workers disabled, 1 replica each
  local min_out
  min_out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-minimal.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml")
  assert_not_contains "minimal: workers disabled" "$min_out" "# Source: langwatch/templates/workers/deployment.yaml"
  assert_contains "minimal: app replicas 1" "$min_out" "replicas: 1"

  # size-prod: 2 app replicas, PDB
  local prod_out
  prod_out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")
  assert_contains "prod: has PodDisruptionBudget" "$prod_out" "kind: PodDisruptionBudget"
  assert_contains "prod: workers deployed" "$prod_out" "# Source: langwatch/templates/workers/deployment.yaml"

  # size-ha: 3 replicas, ClickHouse replicated
  local ha_out
  ha_out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-ha.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")
  assert_contains "ha: 3 CH replicas" "$ha_out" "replicas: 3"
  assert_contains "ha: Keeper StatefulSet" "$ha_out" "name: ${RELEASE}-clickhouse-keeper"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: infrastructure overlays — verify external DB wiring
# ─────────────────────────────────────────────────────────────────────────────
test_infra_overlays() {
  sep; info "Suite: infrastructure overlays"

  # clickhouse-external: no CH StatefulSet, CLICKHOUSE_URL from external
  local ch_ext
  ch_ext=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/clickhouse-external.yaml")
  assert_not_contains "ext-ch: no CH StatefulSet" "$ch_ext" "clickhouse-serverless/templates"
  assert_contains "ext-ch: CLICKHOUSE_URL env" "$ch_ext" "name: CLICKHOUSE_URL"

  # postgres-external: DATABASE_URL from secret
  local pg_ext
  pg_ext=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/postgres-external.yaml")
  assert_contains "ext-pg: DATABASE_URL from secretKeyRef" "$pg_ext" "name: langwatch-db"

  # redis-external: REDIS_URL from secret
  local redis_ext
  redis_ext=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/redis-external.yaml")
  assert_contains "ext-redis: REDIS_URL from secretKeyRef" "$redis_ext" "name: langwatch-redis"

  # clickhouse-replicated: Keeper StatefulSet + 3 replicas
  local ch_repl
  ch_repl=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/clickhouse-replicated.yaml")
  assert_contains "repl-ch: Keeper created" "$ch_repl" "name: ${RELEASE}-clickhouse-keeper"
  assert_contains "repl-ch: CLICKHOUSE_CLUSTER env" "$ch_repl" "name: CLICKHOUSE_CLUSTER"

  # local-images: pullPolicy Never
  local local_img
  local_img=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${OVERLAYS}/local-images.yaml")
  assert_contains "local-images: pullPolicy Never" "$local_img" "imagePullPolicy: Never"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: overlay stacking — later overlays override earlier ones
# ─────────────────────────────────────────────────────────────────────────────
test_overlay_stacking() {
  sep; info "Suite: overlay stacking (last -f wins)"

  # size-dev sets 1 replica, then we override to 3 via --set. Multi-replica
  # also disables localFilesystem (validation refuses local-FS + replicas>1
  # because pods don't share filesystems — operators should use app.dataplane).
  local out
  out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    --set app.replicaCount=3 \
    --set app.storedObjects.localFilesystem.enabled=false)
  assert_contains "stacking: --set overrides overlay" "$out" "replicas: 3"

  # size-dev + access-nodeport, then access-ingress overrides
  local stacked
  stacked=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")
  assert_contains "stacking: ingress overrides nodeport" "$stacked" "kind: Ingress"

  # Regression for Sergio's P1 #3: when dataplane is enabled, the local-FS PVC
  # MUST NOT render even though localFilesystem.enabled defaults to true.
  # Pre-fix this combo would have created an RWO PVC and mounted it into all
  # three replicas.
  local dp
  dp=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    --set app.replicaCount=3 \
    --set app.dataplane.enabled=true \
    --set app.dataplane.provider=awsS3 \
    --set app.dataplane.providers.awsS3.bucket=test-bucket)
  if grep -qF "stored-objects" <<< "$dp" && grep -qF "kind: PersistentVolumeClaim" <<< "$dp"; then
    # The PVC string appears — check it's NOT the stored-objects PVC
    # (other PVCs in the chart are fine; only the stored-objects one is RWO).
    if grep -B1 "name: ${RELEASE}-stored-objects" <<< "$dp" | grep -qF "kind: PersistentVolumeClaim"; then
      fail "dataplane gates local-FS PVC: PVC should NOT render with dataplane.enabled=true"
    else
      pass "dataplane gates local-FS PVC: no stored-objects PVC with dataplane on"
    fi
  else
    pass "dataplane gates local-FS PVC: no stored-objects PVC with dataplane on"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — deploy size-dev + nodeport and verify live resources
# ─────────────────────────────────────────────────────────────────────────────
test_install_dev_nodeport() {
  sep; info "Suite: install size-dev + access-nodeport"

  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml"
  pass "helm install (dev + nodeport)"

  # Verify service type
  local svc_type
  svc_type=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.type}')
  assert_eq "App service type is NodePort" "$svc_type" "NodePort"

  # Verify NodePort value
  local node_port
  node_port=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.ports[0].nodePort}')
  assert_eq "App NodePort is 30560" "$node_port" "30560"

  # Verify ClickHouse pod is running
  wait_ch_ready "${RELEASE}-clickhouse-0"
  pass "ClickHouse-0 ready"

  # Verify PostgreSQL is up
  wait_pod_ready "app.kubernetes.io/component=postgresql" 120
  pass "PostgreSQL ready"

  # Verify Redis is up
  wait_pod_ready "app.kubernetes.io/component=redis" 120
  pass "Redis ready"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — deploy size-minimal and verify minimal resources
# ─────────────────────────────────────────────────────────────────────────────
test_install_minimal() {
  sep; info "Suite: install size-minimal + access-nodeport"

  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-minimal.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml"
  pass "helm install (minimal + nodeport)"

  # Workers should NOT exist
  if kc get deployment "${RELEASE}-workers" &>/dev/null; then
    fail "Workers Deployment should not exist in size-minimal"
  else
    pass "Workers Deployment absent (size-minimal)"
  fi

  # ClickHouse should be a single pod
  local ch_replicas
  ch_replicas=$(kc get statefulset "${RELEASE}-clickhouse" -o jsonpath='{.spec.replicas}')
  assert_eq "ClickHouse replicas = 1" "$ch_replicas" "1"

  # No Keeper (single node)
  if kc get statefulset "${RELEASE}-clickhouse-keeper" &>/dev/null; then
    fail "Keeper should not exist in size-minimal (single node)"
  else
    pass "No Keeper (single node)"
  fi

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — deploy size-prod + ingress and verify resources
# ─────────────────────────────────────────────────────────────────────────────
test_install_prod_ingress() {
  sep; info "Suite: install size-prod + access-ingress"

  # values-e2e.yaml sets replicaCount=0 for app/workers (no private images in CI).
  # Re-enable workers as a Deployment (0 replicas) to verify the resource is created.
  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml" \
    --set workers.enabled=true \
    --set workers.replicaCount=0
  pass "helm install (prod + ingress)"

  # Service type = ClusterIP
  local svc_type
  svc_type=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.type}')
  assert_eq "App service type is ClusterIP" "$svc_type" "ClusterIP"

  # Ingress exists
  kc get ingress "${RELEASE}-ingress" &>/dev/null \
    && pass "Ingress ${RELEASE}-ingress exists" \
    || fail "Ingress ${RELEASE}-ingress missing"

  # Ingress has TLS
  local tls_secret
  tls_secret=$(kc get ingress "${RELEASE}-ingress" \
    -o jsonpath='{.spec.tls[0].secretName}')
  assert_eq "Ingress TLS secret" "$tls_secret" "langwatch-tls"

  # Ingress backend auto-wired. Select the app's catch-all path by VALUE, not by
  # index: ingress.blockedPaths emits /api/internal first, so paths[0] is the
  # blackhole Service, not the app.
  local backend_svc
  backend_svc=$(kc get ingress "${RELEASE}-ingress" \
    -o jsonpath='{.spec.rules[0].http.paths[?(@.path=="/")].backend.service.name}')
  assert_eq "Ingress backend → app" "$backend_svc" "${RELEASE}-app"

  # …and the blocked control-plane prefix really is wired to the no-endpoints
  # blackhole in a live cluster, not just in the rendered template.
  local blocked_svc
  blocked_svc=$(kc get ingress "${RELEASE}-ingress" \
    -o jsonpath='{.spec.rules[0].http.paths[?(@.path=="/api/internal")].backend.service.name}')
  assert_eq "Ingress /api/internal → blackhole" "$blocked_svc" "${RELEASE}-blackhole"

  # The blackhole Service must actually EXIST and be selector-less — that is what
  # makes the block a dead end rather than a route to something live.
  #
  # Asserting on Endpoints instead would be unfalsifiable: a selector-less
  # Service never gets an Endpoints object, so `kc get endpoints` returns
  # NotFound, and an assertion that swallows the error and compares "" to ""
  # also passes when the Service is missing, renamed, or has grown a selector
  # (this suite runs app.replicaCount: 0, so a selector would match no pods and
  # still produce no subsets). Assert the property directly instead.
  kc get svc "${RELEASE}-blackhole" &>/dev/null \
    && pass "Blackhole Service exists" \
    || fail "Blackhole Service ${RELEASE}-blackhole not created"
  local blackhole_selector
  blackhole_selector=$(kc get svc "${RELEASE}-blackhole" -o jsonpath='{.spec.selector}')
  assert_eq "Blackhole Service is selector-less" "$blackhole_selector" ""

  # Workers Deployment created (0 replicas, but resource exists)
  kc get deployment "${RELEASE}-workers" &>/dev/null \
    && pass "Workers Deployment exists" \
    || fail "Workers Deployment missing"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — external ClickHouse overlay
# ─────────────────────────────────────────────────────────────────────────────
test_install_external_ch() {
  sep; info "Suite: install with clickhouse-external overlay"

  # clickhouse-external overlay must come AFTER values-e2e.yaml (which sets chartManaged=true)
  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml" \
    -f "${OVERLAYS}/clickhouse-external.yaml"
  pass "helm install (prod + external CH)"

  # No ClickHouse StatefulSet
  if kc get statefulset "${RELEASE}-clickhouse" &>/dev/null; then
    fail "ClickHouse StatefulSet should not exist (external mode)"
  else
    pass "No ClickHouse StatefulSet (external)"
  fi

  # CLICKHOUSE_URL env set on app deployment
  local ch_url
  ch_url=$(kc get deployment "${RELEASE}-app" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CLICKHOUSE_URL")].value}')
  assert_contains "CLICKHOUSE_URL has external host" "$ch_url" "my-clickhouse"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — profile values-local.yaml
# ─────────────────────────────────────────────────────────────────────────────
test_install_profile_local() {
  sep; info "Suite: install profile values-local.yaml"

  helm_install -f "${CHART_DIR}/examples/values-local.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml"
  pass "helm install (values-local.yaml)"

  # NodePort
  local svc_type
  svc_type=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.type}')
  assert_eq "Local profile: NodePort" "$svc_type" "NodePort"

  # ClickHouse running
  wait_ch_ready "${RELEASE}-clickhouse-0" 120
  pass "Local profile: ClickHouse ready"

  helm_uninstall
}

# ─── Image loading ────────────────────────────────────────────────────────────
load_images() {
  sep; info "Building and loading images for install tests"

  local ch_image="langwatch/clickhouse-serverless:next"
  local ch_dir="${CHART_DIR}/../../clickhouse-serverless"

  if ! docker image inspect "$ch_image" &>/dev/null 2>&1; then
    if [[ -f "$ch_dir/Dockerfile" ]]; then
      info "Building ClickHouse image: $ch_image"
      docker build -t "$ch_image" "$ch_dir"
    fi
  fi

  if docker image inspect "$ch_image" &>/dev/null 2>&1; then
    info "Loading $ch_image into Kind"
    kind load docker-image "$ch_image" --name "$CLUSTER_NAME"
  fi

  pass "Images loaded"
}

# ─────────────────────────────────────────────────────────────────────────────
main() {
  # Start fresh locally; in CI (KEEP_CLUSTER=true) the cluster is pre-created
  if [[ "${KEEP_CLUSTER:-false}" != "true" ]]; then
    kind delete cluster --name "$CLUSTER_NAME" 2>/dev/null || true
  fi

  setup_kind
  wait_api

  # Update chart dependencies
  helm dependency update "$CHART_DIR" > /dev/null 2>&1

  # Phase 1: Template rendering (fast, no deploy)
  test_template_rendering
  test_profile_rendering
  test_access_nodeport
  test_access_ingress
  test_langwatch_endpoint
  test_backup_metrics_gate
  test_size_overlays
  test_infra_overlays
  test_overlay_stacking

  # Phase 2: Live installs (slower, needs Kind + images)
  load_images
  test_install_dev_nodeport
  test_install_minimal
  test_install_prod_ingress
  test_install_external_ch
  test_install_profile_local

  sep
  pass "All overlay E2E tests passed"
}

main "$@"
