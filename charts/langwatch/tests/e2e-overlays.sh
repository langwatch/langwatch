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

# Temp files registered here are removed on exit, however the script leaves.
TMP_FILES=()
cleanup_all() {
  rm -f "${TMP_FILES[@]:-}"
  cleanup_cluster
}
trap cleanup_all EXIT

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
  if grep -qF -- "$needle" <<< "$haystack"; then
    pass "$label"
  else
    fail "$label: expected to find '$needle'"
  fi
}

# Check rendered YAML does NOT contain a string
assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if grep -qF -- "$needle" <<< "$haystack"; then
    fail "$label: expected NOT to find '$needle'"
  else
    pass "$label"
  fi
}

# Count occurrences of a pattern in rendered YAML
count_matches() {
  local haystack="$1" pattern="$2"
  # grep -c already prints 0 when there are no matches; it just exits 1. The
  # `|| echo 0` form would append a SECOND line, and the caller's (( n >= 10 ))
  # then dies with an arithmetic syntax error instead of reporting the count.
  grep -c -- "$pattern" <<< "$haystack" || true
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

  local out
  out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")

  # Ingress resource created
  assert_contains "Ingress created" "$out" "kind: Ingress"
  assert_contains "Ingress class is nginx" "$out" "ingressClassName: nginx"
  assert_contains "TLS secret configured" "$out" "secretName: langwatch-tls"
  assert_contains "Ingress host set" "$out" "langwatch.example.com"

  # Backend auto-wired to app service
  assert_contains "Backend → lw-app" "$out" "name: ${RELEASE}-app"

  # Service type = ClusterIP (default, not NodePort)
  assert_not_contains "No NodePort" "$out" "type: NodePort"
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

  # size-minimal: workers enabled (the smoke test exercises them), 1 replica each
  local min_out
  min_out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-minimal.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml")
  assert_contains "minimal: workers deployed" "$min_out" "# Source: langwatch/templates/workers/deployment.yaml"
  # Scoped to the app Deployment: the full render carries six other `replicas: 1`
  # lines (redis, postgres, clickhouse, nlp, langevals), so a whole-document
  # grep passes even for size-prod, where the app has two.
  local min_app
  min_app=$(tmpl_only "templates/app/deployment.yaml" --set autogen.enabled=true \
    -f "${OVERLAYS}/size-minimal.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml")
  assert_contains "minimal: app replicas 1" "$min_app" "replicas: 1"

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
# SUITE: pod security hardening — guard the strict-admission posture
#
# Assertions here are scoped PER WORKLOAD via --show-only, never grepped over
# the whole render. A whole-render grep ("is readOnlyRootFilesystem present?")
# passes when one container out of ten has it, and a whole-render count
# ("at least 10 sites") passes when a workload regresses as long as some other
# workload gains a field. Both let the exact regression they name through.
#
# Two workloads deliberately do NOT comply and are listed as exemptions below.
# An exemption is only legitimate if strict-admission.yaml turns that workload
# off, which the last block asserts.
# ─────────────────────────────────────────────────────────────────────────────

# Workloads LangWatch authors and hardens. Every container must carry the full
# posture. Adding a workload to the chart without adding it here fails the
# "no untriaged workloads" check below — that is deliberate.
HARDENED_WORKLOADS=(
  "templates/app/deployment.yaml"
  "templates/workers/deployment.yaml"
  "templates/langwatch_nlp/deployment.yaml"
  "templates/langevals/deployment.yaml"
  "templates/postgresql/statefulset.yaml"
  "templates/redis/statefulset.yaml"
  "charts/gateway/templates/deployment.yaml"
  "charts/clickhouse/templates/statefulset.yaml"
)

# Workloads that render only behind a non-default value. They are as
# operator-facing as the default ones, and the default render cannot see them,
# so each needs its own flag set.
HARDENED_WORKLOADS_GATED=(
  "charts/clickhouse/templates/keeper-statefulset.yaml"
  "charts/clickhouse/templates/backup-cronjobs.yaml"
  "templates/cronjobs/cronjobs.yaml"
)

CH_FULL_FLAGS=(--set autogen.enabled=true
               --set clickhouse.replicas=3
               --set clickhouse.backup.enabled=true
               --set clickhouse.objectStorage.bucket=test
               --set clickhouse.objectStorage.region=us-east-1)

# values.yaml ships `cronjobs.jobs: {}` as an operator extension point, so the
# template renders nothing by default. Populate one so it is actually exercised.
CRONJOB_FLAGS=(--set autogen.enabled=true
               --set cronjobs.jobs.probe.enabled=true
               --set "cronjobs.jobs.probe.schedule=0 0 * * *"
               --set cronjobs.jobs.probe.endpoint=/api/cron/probe)

# Workloads that cannot comply, each with the reason and the values key that
# removes it. strict-admission.yaml must set every one of these to false.
EXEMPT_WORKLOADS=(
  # Upstream subchart we do not control: no readOnlyRootFilesystem, no seccomp,
  # no limits on the config-reload sidecar.
  "charts/prometheus/templates/deploy.yaml:prometheus.chartManaged"
  # Root by design: the manager needs CHOWN/DAC_OVERRIDE/FOWNER/SETUID/SETGID
  # to hand each worker a distinct UID. Forcing it non-root re-opens
  # cross-worker credential theft (ADR-033).
  "charts/langyagent/templates/deployment.yaml:langyagent.chartManaged"
  # Runs kubectl against Secrets, so it needs its token and a writable root for
  # kubectl's discovery cache. Only renders on the operator-owned-Secret path.
  "charts/clickhouse/templates/preflight-secrets-job.yaml:clickhouse.preflight.enabled"
)

# Every emptyDir in the rendered manifest must declare a sizeLimit: they are
# backed by node ephemeral storage, so an unbounded one lets a single looping
# pod evict its neighbours. Counts, not presence — these templates carry
# several, and a presence check passes while any one of them loses its bound.
assert_every_emptydir_bounded() {
  local label="$1" manifest="$2" dirs bounded
  dirs=$(count_matches "$manifest" "^[[:space:]]*emptyDir:")
  bounded=$(count_matches "$manifest" "^[[:space:]]*sizeLimit:")
  if (( dirs == bounded )); then
    pass "hardening: $label — all $dirs emptyDir(s) size-bounded"
  else
    fail "hardening: $label — $bounded of $dirs emptyDir(s) size-bounded"
  fi
}

# Assert one workload template carries the full hardened posture on EVERY
# container of EVERY pod spec it renders. Extra helm flags may follow the
# template path (some workloads only render when a feature is on).
#
# This reads fields off each container OBJECT via charts/lib/pod-security-report.rb.
# Counting matches across the rendered text does not work: a template with three
# pod specs keeps its totals unchanged when a field moves from a container up to
# the pod level (where Kubernetes ignores it), so a counting assertion reports
# full coverage while containers run unhardened. Presence greps are worse again —
# one hit anywhere satisfies them for the whole document.
assert_workload_hardened() {
  local tpl="$1"; shift
  local out report
  out=$(tmpl_only "$tpl" "$@") || {
    fail "hardening: could not render $tpl"; return
  }
  report=$(ruby "${CHART_DIR}/../lib/pod-security-report.rb" <<< "$out") || {
    fail "hardening[$tpl]: could not parse the rendered manifest"; return
  }
  if [[ -z "$report" ]]; then
    fail "hardening[$tpl]: rendered no containers"; return
  fi

  local id cname ro ape nonroot podnonroot caps seccomp automount res
  local missing failures=0 containers=0
  while IFS='|' read -r id cname ro ape nonroot podnonroot caps seccomp automount res; do
    [[ -z "$id" ]] && continue
    containers=$((containers + 1))
    missing=""
    (( ro == 1 ))         || missing+=" readOnlyRootFilesystem:true"
    (( ape == 1 ))        || missing+=" allowPrivilegeEscalation:false"
    (( caps == 1 ))       || missing+=" capabilities.drop:[ALL]"
    (( res == 1 ))        || missing+=" resources.requests+limits(cpu,memory)"
    # runAsNonRoot is required at BOTH levels. Kubernetes inherits the pod-level
    # value, but some Gatekeeper constraints read the container field directly
    # and deny a pod that carries it only on the pod.
    (( nonroot == 1 ))    || missing+=" container.runAsNonRoot:true"
    (( podnonroot == 1 )) || missing+=" pod.runAsNonRoot:true"
    (( seccomp == 1 ))    || missing+=" pod.seccompProfile:RuntimeDefault"
    (( automount == 1 ))  || missing+=" pod.automountServiceAccountToken:false"
    if [[ -n "$missing" ]]; then
      fail "hardening[$tpl]: ${id} container '${cname}' missing:${missing}"
      failures=$((failures + 1))
    fi
  done <<< "$report"

  if (( failures == 0 )); then
    pass "hardening[$tpl]: all $containers container(s) fully hardened"
  fi

  assert_not_contains "hardening[$tpl]: not privileged" "$out" "privileged: true"
}

test_pod_security() {
  sep; info "Suite: pod security hardening"

  local tpl
  for tpl in "${HARDENED_WORKLOADS[@]}"; do
    assert_workload_hardened "$tpl" --set autogen.enabled=true
  done

  # Keeper, the backup/restore Jobs and the cron pods render only when a
  # non-default value switches them on, so the default pass above never sees
  # them. That blind spot is not theoretical: the cronjobs template shipped
  # unrenderable because nothing in the repo ever rendered it.
  for tpl in "${HARDENED_WORKLOADS_GATED[@]}"; do
    case "$tpl" in
      templates/cronjobs/*) assert_workload_hardened "$tpl" "${CRONJOB_FLAGS[@]}" ;;
      *)                    assert_workload_hardened "$tpl" "${CH_FULL_FLAGS[@]}" ;;
    esac
  done

  # The hardened posture must also survive the overlays operators actually
  # install — strict-admission most of all, since it is what the docs tell a
  # locked-down cluster to apply. A per-component securityContext override in an
  # overlay now MERGES over the defaults, so an overlay could relax a control
  # without the default render noticing.
  for tpl in "${HARDENED_WORKLOADS[@]}"; do
    assert_workload_hardened "$tpl" --set autogen.enabled=true \
      -f "${OVERLAYS}/strict-admission.yaml"
  done

  # The backup Jobs talk to S3, so they must carry the chart's ServiceAccount
  # rather than falling through to the namespace default, which would miss an
  # IRSA annotation set on the chart SA. Assert the VALUE: the key alone is
  # satisfied by `serviceAccountName: default`, which is the bug.
  local backup_out
  backup_out=$(tmpl_only "charts/clickhouse/templates/backup-cronjobs.yaml" "${CH_FULL_FLAGS[@]}")
  assert_contains "hardening: backup Jobs use the chart ServiceAccount" "$backup_out" \
    "serviceAccountName: ${RELEASE}-clickhouse"

  # Scratch volumes are bounded so a pod in an error loop is evicted on its own
  # quota instead of filling the node's ephemeral storage. Compare counts, not
  # presence: these templates carry several emptyDirs and a presence check is
  # satisfied while any one of them silently loses its bound.
  local ch_sts
  ch_sts=$(tmpl_only "charts/clickhouse/templates/statefulset.yaml" "${CH_FULL_FLAGS[@]}")
  assert_every_emptydir_bounded "clickhouse statefulset" "$ch_sts"
  assert_every_emptydir_bounded "backup Jobs" "$backup_out"
  assert_every_emptydir_bounded "keeper" \
    "$(tmpl_only "charts/clickhouse/templates/keeper-statefulset.yaml" "${CH_FULL_FLAGS[@]}")"
  assert_every_emptydir_bounded "postgresql" \
    "$(tmpl_only "templates/postgresql/statefulset.yaml" --set autogen.enabled=true)"
  assert_every_emptydir_bounded "redis" \
    "$(tmpl_only "templates/redis/statefulset.yaml" --set autogen.enabled=true)"

  local def
  def=$(tmpl --set autogen.enabled=true)

  # ClickHouse pins its image uid explicitly rather than relying on the USER
  # directive, so MustRunAs policies that read the pod spec accept it.
  local ch
  ch=$(tmpl_only "charts/clickhouse/templates/statefulset.yaml" --set autogen.enabled=true)
  assert_contains "hardening: clickhouse pins uid 101" "$ch" "runAsUser: 101"

  # The app moved off Next.js; the dead permissions init container stays gone.
  assert_not_contains "hardening: no dead next.js init container" "$def" "fix-nextjs-permissions"

  # A per-component securityContext override layers onto the hardened global
  # default rather than replacing it: the overridden key takes the operator's
  # value, every other key keeps its default. Checked at both pod and container
  # level, since each has its own merge site.
  local pod_override cont_override
  pod_override=$(tmpl_only "templates/app/deployment.yaml" \
    --set autogen.enabled=true --set app.podSecurityContext.fsGroup=2000)
  assert_contains "override: fsGroup applied"            "$pod_override" "fsGroup: 2000"
  assert_contains "override: keeps runAsNonRoot default" "$pod_override" "runAsNonRoot: true"
  assert_contains "override: keeps seccomp default"      "$pod_override" "type: RuntimeDefault"

  cont_override=$(tmpl_only "templates/app/deployment.yaml" \
    --set autogen.enabled=true --set app.containerSecurityContext.readOnlyRootFilesystem=false)
  assert_contains "override: readOnlyRootFilesystem applied"    "$cont_override" "readOnlyRootFilesystem: false"
  assert_contains "override: keeps allowPrivilegeEscalation"    "$cont_override" "allowPrivilegeEscalation: false"
  assert_contains "override: keeps dropped capabilities"        "$cont_override" "- ALL"

  # No workload may exist that is neither hardened nor a recorded exemption.
  #
  # The triage set is the UNION of the default render and every feature-gated
  # render, because a workload that is off by default is exactly where an
  # unhardened one hides — reading the default render alone is how the cronjobs
  # template stayed untriaged and unrenderable. LC_ALL=C pins byte ordering so
  # `comm`'s sorted-input contract holds regardless of runner locale; comm does
  # not warn when it is violated, it just returns the wrong answer.
  local rendered expected found all_renders
  all_renders=$(
    printf '%s\n' "$def"
    tmpl "${CH_FULL_FLAGS[@]}"
    tmpl "${CRONJOB_FLAGS[@]}"
    tmpl --set autogen.enabled=true --set clickhouse.preflight.enabled=true \
      --set clickhouse.autogen.enabled=false --set clickhouse.auth.existingSecret=ch-secret 2>/dev/null || true
  )
  rendered=$(awk '/^# Source:/{src=$3} /^kind: (Deployment|StatefulSet|CronJob|Job)$/{print src}' <<< "$all_renders" \
    | sed 's|^langwatch/||' | LC_ALL=C sort -u)
  expected=$(printf '%s\n' "${HARDENED_WORKLOADS[@]}" "${HARDENED_WORKLOADS_GATED[@]}" \
    "${EXEMPT_WORKLOADS[@]%%:*}" | LC_ALL=C sort -u)
  found=$(LC_ALL=C comm -23 <(printf '%s\n' "$rendered") <(printf '%s\n' "$expected") || true)
  if [[ -z "$found" ]]; then
    pass "hardening: no untriaged workloads across default + feature-gated renders"
  else
    fail "hardening: workload(s) neither hardened nor exempt: $(tr '\n' ' ' <<< "$found")"
  fi

  # strict-admission overlay must remove every exempt workload, and the
  # gateway HPA. Asserted against the workload's own template source, so an
  # unrelated resource keeping the same string cannot mask a failure.
  local strict entry
  strict=$(tmpl --set autogen.enabled=true -f "${OVERLAYS}/strict-admission.yaml")
  # tmpl folds stderr into its output, so a failed render is a string that
  # happens to contain none of the needles below — every assert_not_contains
  # would pass on a broken overlay. Confirm we are looking at a real manifest
  # before drawing conclusions from what is missing from it.
  assert_contains "strict-admission: overlay renders a manifest" "$strict" "kind: Deployment"
  for entry in "${EXEMPT_WORKLOADS[@]}"; do
    assert_not_contains "strict-admission: ${entry##*:} off" "$strict" "# Source: langwatch/${entry%%:*}"
  done
  assert_not_contains "strict-admission: gateway HPA off" "$strict" "# Source: langwatch/charts/gateway/templates/hpa.yaml"

  # app metrics: prove the overlay actually suppresses the scrape annotation.
  # Asserting its absence against a default render is vacuous — the annotation
  # is off by chart default, so it is absent whether or not the overlay works.
  #
  # The overlay's job is to win over a BASE VALUES FILE that turned metrics on,
  # so the baseline has to come from `-f` too: `--set` outranks every `-f`
  # regardless of order, so a --set baseline could never be overridden and the
  # test would fail against a perfectly good overlay.
  # Registered for cleanup rather than removed inline: fail() exits, so a
  # trailing rm never runs on the failure path and each red CI run would leak
  # a temp file. (A `trap ... RETURN` here would be worse — it is global, so it
  # fires on every later function return, where this local is gone and `set -u`
  # makes that fatal.)
  local metrics_base
  metrics_base=$(mktemp)
  TMP_FILES+=("$metrics_base")
  cat > "$metrics_base" <<'YAML'
app:
  telemetry:
    metrics:
      enabled: true
      apiKey:
        value: test-key
YAML
  local metrics_on metrics_off
  metrics_on=$(tmpl --set autogen.enabled=true -f "$metrics_base")
  assert_contains "baseline: app metrics scrape present when enabled" "$metrics_on" "prometheus.io/scrape"
  metrics_off=$(tmpl --set autogen.enabled=true -f "$metrics_base" -f "${OVERLAYS}/strict-admission.yaml")
  assert_contains "strict-admission: metrics render produced a manifest" "$metrics_off" "kind: Deployment"
  assert_not_contains "strict-admission: app metrics scrape off" "$metrics_off" "prometheus.io/scrape"
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
# SUITE: workers liveness probe
#
# The worker probes must target the UNAUTHENTICATED /healthz path and carry no
# credentials. Probing /metrics instead crash-loops the pod in two independent
# ways, and both are default-ish configurations:
#
#   1. Stock install — app.telemetry.metrics.enabled is false, so
#      METRICS_API_KEY is never emitted; with NODE_ENV=production the endpoint
#      fails closed with 500 to every caller.
#   2. secretKeyRef install — a kubelet httpGet probe cannot read a Secret, so
#      no rendered Authorization header can carry the key and the probe gets 401.
#
# Baking the token into the podspec as a plain httpHeader is not a fix either:
# it copies a secret into an object readable by anyone with `get deploy`, and
# it still cannot cover case 1. See specs/server/worker-liveness-probe.feature.
# ─────────────────────────────────────────────────────────────────────────────
test_workers_probes() {
  sep; info "Suite: workers liveness probe"

  local workers_only
  workers_only=$(tmpl_only "templates/workers/deployment.yaml" \
    --set autogen.enabled=true --set workers.enabled=true)

  assert_contains "workers probe path is /healthz" "$workers_only" "path: /healthz"
  assert_not_contains "workers probe never targets /metrics" \
    "$workers_only" "path: /metrics"
  # Both probes, not just one — a startupProbe that passes while livenessProbe
  # 500s still crash-loops the pod after startup.
  local healthz_count
  healthz_count=$(count_matches "$workers_only" "path: /healthz")
  assert_eq "both startup and liveness probes use /healthz" "$healthz_count" "2"

  # With a plain-value key configured the podspec must STILL carry no probe
  # credentials — the token belongs in the env var (from the Secret), never in
  # a probe header.
  local with_key
  with_key=$(tmpl_only "templates/workers/deployment.yaml" \
    --set autogen.enabled=true --set workers.enabled=true \
    --set app.telemetry.metrics.enabled=true \
    --set app.telemetry.metrics.apiKey.value=probe-should-not-carry-this)
  assert_not_contains "probes carry no httpHeaders when a key is set" \
    "$with_key" "httpHeaders"
  # The key still reaches the container as env (that is how the worker gates
  # /metrics) — assert it is present there so this test can't pass by the key
  # silently not being wired at all.
  assert_contains "metrics key still reaches the container env" \
    "$with_key" "probe-should-not-carry-this"

  # The secretKeyRef path renders the env from the Secret and, again, no header.
  local with_secret_ref
  with_secret_ref=$(tmpl_only "templates/workers/deployment.yaml" \
    --set autogen.enabled=true --set workers.enabled=true \
    --set app.telemetry.metrics.enabled=true \
    --set app.telemetry.metrics.apiKey.secretKeyRef.name=metrics-secret \
    --set app.telemetry.metrics.apiKey.secretKeyRef.key=apiKey)
  assert_contains "secretKeyRef key reaches the container env" \
    "$with_secret_ref" "name: metrics-secret"
  assert_not_contains "probes carry no httpHeaders under secretKeyRef" \
    "$with_secret_ref" "httpHeaders"
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

  # values-e2e.yaml is passed last and sets workers.enabled=false, so this
  # asserts the ENABLE GATE still removes the Deployment. It is not a statement
  # about size-minimal, which enables workers — the label used to say otherwise
  # and only stayed green by accident of the -f ordering.
  if kc get deployment "${RELEASE}-workers" &>/dev/null; then
    fail "workers.enabled=false should remove the Workers Deployment"
  else
    pass "Workers Deployment absent (workers.enabled=false via values-e2e)"
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

  # Ingress backend auto-wired
  local backend_svc
  backend_svc=$(kc get ingress "${RELEASE}-ingress" \
    -o jsonpath='{.spec.rules[0].http.paths[0].backend.service.name}')
  assert_eq "Ingress backend → app" "$backend_svc" "${RELEASE}-app"

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
  test_pod_security
  test_infra_overlays
  test_overlay_stacking
  test_workers_probes

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
