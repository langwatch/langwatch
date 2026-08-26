#!/usr/bin/env bash
# Upgrade-access harness for the clickhouse-serverless chart — langwatch-saas#1168.
#
# WHAT THIS ANSWERS
#   Does pre-existing SQL access state survive a replicated old->new upgrade?
#   The new image renders <user_directories replace="replace"> and relocates the
#   access store from the PVC (/var/lib/clickhouse/access/) to Keeper
#   (/clickhouse/<clusterName>/access/). No code in the diff migrates it. This
#   harness is the experiment that characterises what happens.
#
#   Server-and-chart only: kubectl exec + clickhouse-client, no app in the loop.
#
# A RED RUN IS A RESULT, NOT A SETBACK
#   Phases p1_4 and p1_5 are EXPECTED to fail. Failure is the finding. The exit
#   codes below exist so a genuine AC failure is never confused with a harness
#   or environment bug.
#
# EXIT CODES
#   0   every requested phase passed
#   10  HARNESS/ENVIRONMENT error — missing tool, kind/docker/helm failure,
#       image not loadable, setup step broke. NOT an AC result.
#   20  VOID — the run is not in the topology it claims to be testing (AC7's
#       void rule). Nothing after this point would mean anything. This is also
#       the expected exit of AC24(b): `REPLICAS=1 bash tests/upgrade-access.sh`.
#   30  AC FAILURE — a real acceptance criterion failed. The failing AC is named
#       in the [FAIL <AC>] line and its measurement is printed verbatim above it.
#   40  usage error.
#
# ENVIRONMENT
#   REPLICAS=3|1        topology (default 3). 1 is the AC24(b) negative control
#                       and MUST exit 20 — it is not a supported green path.
#   OLD_TAG             released tag installed first (default 0.3.0 —
#                       values.yaml:3 on origin/main, pre-access.go).
#   NEW_TAG             tag upgraded to (default pr7331-28f563af).
#   IMAGE_REPO          default langwatch/clickhouse-serverless
#   PHASES              space-separated subset of:
#                         p1_2 p1_3 p1_4 p1_5 p1_6 p1_7 p1_8
#                       default "p1_2 p1_3 p1_4 p1_5 p1_6 p1_8" (p1_7 rebuilds
#                       the substrate from scratch, so it is opt-in).
#   PROPAGATION_TIMEOUT_S  AC23 enforced bound, capped at 15 (default 15).
#                          A run with 0 MUST fail — that is AC23(c).
#   NEGATIVE_CONTROL_DROP_ENTITY=user|grant|policy|profile|collection
#                       AC24(a): drop one seeded entity on every pod immediately
#                       before the AC8 check. The harness MUST then exit 30.
#   REUSE_CLUSTER=true  skip the fresh-kind-cluster create (debugging only —
#                       violates R6 substrate hygiene, printed as a warning).
#   KEEP_CLUSTER=true   do not delete the kind cluster on exit (debugging).
#   CLUSTER_NAME        kind cluster name (default ch-upgrade).
#   TIMEOUT             helm --wait timeout in seconds (default 600).
#
# REQUIREMENTS
#   kind, docker, helm, kubectl. No crane: the AC20 digest comparison is done
#   against the LOCAL image id, because kind side-loads and there is no registry
#   in the loop. The crane/manifest-list form of AC20 belongs to the EKS legs.
#
# ANTI-SILENCE (plan §5.2)
#   Every assertion prints what it measured. An empty or missing measurement is
#   a FAIL, never a skip. Characterisation ACs (AC15a, AC15b, AC11) record the
#   outcome per entity class with the command and its verbatim output; an
#   unrecorded class fails the AC.

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

REPLICAS="${REPLICAS:-3}"
IMAGE_REPO="${IMAGE_REPO:-langwatch/clickhouse-serverless}"
OLD_TAG="${OLD_TAG:-0.3.0}"
NEW_TAG="${NEW_TAG:-pr7331-28f563af}"

CLUSTER_NAME="${CLUSTER_NAME:-ch-upgrade}"
RELEASE="ch"
NAMESPACE="ch-upgrade"
FULLNAME="${RELEASE}-clickhouse"
KEEPER_STS="${FULLNAME}-keeper"
CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VALUES="${CHART_DIR}/tests/values-upgrade.yaml"
TIMEOUT="${TIMEOUT:-600}"

# AC23(b): the enforced propagation bound. Capped at 15 by the AC so the
# threshold cannot be made vacuous by writing 600.
PROPAGATION_TIMEOUT_S="${PROPAGATION_TIMEOUT_S:-15}"
PROPAGATION_CAP_S=15

# AC19: how long an auth attempt below Keeper quorum may take before a hang is
# indistinguishable from a slow error, and how long recovery may take.
KEEPER_ERROR_TIMEOUT_S=30
KEEPER_RECOVERY_TIMEOUT_S=300

# AC12: the bounded failure envelope around the rolling window.
AC12_RECOVERY_S=30
AC12_SAMPLE_INTERVAL_S=2

PROBE_USER="up_probe"
PROBE_PW="probe-pw"
ADMIN_PW="upgrade-e2e"   # must match auth.password in values-upgrade.yaml
PROBE_CLIENT_POD="up-probe-client"

DEFAULT_PHASES="p1_2 p1_3 p1_4 p1_5 p1_6 p1_8"
PHASES="${PHASES:-$DEFAULT_PHASES}"

RUN_DIR="$(mktemp -d -t ch-upgrade-access-XXXXXX)"

# Populated as the run proceeds.
OLD_IMAGE_ID=""
NEW_IMAGE_ID=""
CLUSTER_SECRET_BEFORE=""
OLD_REVISION=""

# shellcheck source=../../lib/test-helpers.sh
source "$(cd "$(dirname "$0")/../../lib" && pwd)/test-helpers.sh"

# ─── Failure attribution ─────────────────────────────────────────────────────
# CURRENT_AC is the attribution channel. While it is HARNESS, any failure —
# including one raised from inside a sourced helper — is an environment/harness
# bug (exit 10). While it names an AC, a failure is that AC failing (exit 30).

CURRENT_AC="HARNESS"

harness_error() {
  echo -e "\n${RED}[HARNESS-ERROR]${NC} $*" >&2
  echo -e "${RED}[HARNESS-ERROR]${NC} This is a harness or environment bug, NOT an AC result." >&2
  exit 10
}

void_abort() {
  echo -e "\n${RED}[VOID]${NC} $*" >&2
  echo -e "${RED}[VOID]${NC} AC7 void rule: every assertion in this run is void. Not a pass." >&2
  exit 20
}

ac_fail() {
  echo -e "\n${RED}[FAIL ${CURRENT_AC}]${NC} $*" >&2
  echo -e "${RED}[FAIL ${CURRENT_AC}]${NC} Evidence for this failure is printed verbatim above." >&2
  exit 30
}

# Overrides the helper library's fail() so helper-internal failures are
# attributed to whatever is currently under test rather than all collapsing to
# exit 1. Defined AFTER the source, so it wins.
fail() {
  if [[ "$CURRENT_AC" == "HARNESS" ]]; then
    harness_error "$*"
  fi
  ac_fail "$*"
}

ac() {
  CURRENT_AC="$1"; shift
  sep
  info "$(ts) ── ${CURRENT_AC} — $*"
}

phase() {
  CURRENT_AC="HARNESS"
  sep; sep
  info "$(ts) ══ PHASE $* ══"
}

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# ─── Anti-silence measurement primitives (plan §5.2) ─────────────────────────

MEASURED=""
MEASURED_RC=0

# Runs a command, prints its output verbatim under the current AC, and stores it
# in $MEASURED. Empty output FAILS: an unrecorded measurement is not a skip.
# Must be called as a statement — never inside $( ), where its exit would only
# leave a subshell.
measure() {
  local label="$1"; shift
  _measure_run "$label" "$@"
  if [[ -z "${MEASURED//[[:space:]]/}" ]]; then
    ac_fail "${label}: measurement is EMPTY. Anti-silence rule (plan §5.2): an empty or missing measurement is a FAIL, never a skip."
  fi
}

# Same, but an empty result is a legitimate observation (absence-shaped checks).
# The command still has to RUN; a command that could not run is a failure.
measure_allow_empty() {
  local label="$1"; shift
  _measure_run "$label" "$@"
}

_measure_run() {
  local label="$1"; shift
  MEASURED_RC=0
  MEASURED="$("$@" 2>&1)" || MEASURED_RC=$?
  echo -e "${CYAN}[MEASURED ${CURRENT_AC}]${NC} $(ts) ${label} (rc=${MEASURED_RC})"
  if [[ -z "${MEASURED//[[:space:]]/}" ]]; then
    echo "    | <empty>"
  else
    printf '%s\n' "$MEASURED" | sed 's/^/    | /'
  fi
}

ac_assert_eq() {
  local label="$1" actual="$2" expected="$3"
  echo -e "${CYAN}[MEASURED ${CURRENT_AC}]${NC} $(ts) ${label}: got '${actual}', expected '${expected}'"
  if [[ -z "${actual//[[:space:]]/}" ]]; then
    ac_fail "${label}: measured value is EMPTY (plan §5.2) — expected '${expected}'"
  fi
  if [[ "$actual" != "$expected" ]]; then
    ac_fail "${label}: expected '${expected}', got '${actual}'"
  fi
  pass "${CURRENT_AC} ${label}"
}

ac_assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  echo -e "${CYAN}[MEASURED ${CURRENT_AC}]${NC} $(ts) ${label}: looking for '${needle}' in:"
  if [[ -z "${haystack//[[:space:]]/}" ]]; then
    echo "    | <empty>"
    ac_fail "${label}: measured value is EMPTY (plan §5.2) — expected it to contain '${needle}'"
  fi
  printf '%s\n' "$haystack" | sed 's/^/    | /'
  if [[ "$haystack" != *"$needle"* ]]; then
    ac_fail "${label}: expected output to contain '${needle}'"
  fi
  pass "${CURRENT_AC} ${label}"
}

# ─── Topology helpers ────────────────────────────────────────────────────────

ch_pods() {
  local i
  for ((i = 0; i < REPLICAS; i++)); do echo "${FULLNAME}-${i}"; done
}

keeper_pods() {
  local i
  [[ "$REPLICAS" -gt 1 ]] || return 0
  for ((i = 0; i < REPLICAS; i++)); do echo "${KEEPER_STS}-${i}"; done
}

all_image_pods() { ch_pods; keeper_pods; }

# Every seeded-entity assertion is gated on this. AC8 is explicit that an
# unreachable pod FAILS the AC and must not be recorded as "not reachable,
# noted" — otherwise the AC passes precisely when the cluster is broken.
require_all_pods_ready() {
  local pod
  for pod in $(ch_pods); do
    if ! kc wait pod "$pod" --for=condition=Ready --timeout=120s >/dev/null 2>&1; then
      measure_allow_empty "pod $pod state (unreachable)" kc get pod "$pod" -o wide
      ac_fail "pod ${pod} is not Ready — AC8 precondition. An unreachable pod FAILS this AC."
    fi
  done
  pass "${CURRENT_AC} all ${REPLICAS} ClickHouse pods Ready"
}

probe_query() {
  local pod="$1" query="$2"
  kc exec "$pod" -- clickhouse-client --user "$PROBE_USER" --password "$PROBE_PW" -q "$query"
}

# ─── Substrate hygiene (R6 / P1.9) ───────────────────────────────────────────
# `helm uninstall` does NOT remove StatefulSet PVCs — the chart declares no
# persistentVolumeClaimRetentionPolicy — and the credentials Secret carries
# helm.sh/resource-policy: keep (templates/secret.yaml:56). Leftover Keeper data
# and leftover credentials are exactly how a second run manufactures a false
# "survived the upgrade" pass. Both are removed explicitly.
purge_substrate() {
  info "$(ts) Purging substrate (R6): release, PVCs, kept Secret, namespace"
  hc uninstall "$RELEASE" --wait >/dev/null 2>&1 || true
  kc delete pvc --all --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kc delete secret "$FULLNAME" --ignore-not-found >/dev/null 2>&1 || true
  kc delete pod "$PROBE_CLIENT_POD" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl --context "$KUBE_CTX" delete namespace "$NAMESPACE" --wait=false >/dev/null 2>&1 || true
  local attempts=0
  while kubectl --context "$KUBE_CTX" get namespace "$NAMESPACE" &>/dev/null \
        && [[ $attempts -lt 60 ]]; do
    sleep 2; attempts=$((attempts + 1))
  done
  if kubectl --context "$KUBE_CTX" get namespace "$NAMESPACE" &>/dev/null; then
    harness_error "namespace ${NAMESPACE} still present after 120s — refusing to run on a dirty substrate (R6)"
  fi
  pass "substrate purged"
}

setup_substrate() {
  if [[ "${REUSE_CLUSTER:-false}" == "true" ]]; then
    warn "REUSE_CLUSTER=true — reusing the existing kind cluster. This violates R6"
    warn "substrate hygiene; a green result on a reused substrate is not trustworthy."
    setup_kind
    wait_api
    purge_substrate
    return
  fi
  info "$(ts) Deleting any existing kind cluster ${CLUSTER_NAME} (R6: fresh substrate per run)"
  kind delete cluster --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
  setup_kind
  wait_api
}

# ─── Image side-loading ──────────────────────────────────────────────────────

# Both published tags are multi-platform manifest lists. `kind load docker-image`
# shells out to `ctr images import --all-platforms`, which fails on a docker
# containerd store that only holds the native child ("content digest ... not
# found"). Saving a single platform first is the working path, and it also
# yields the honest expected identity for AC20: the arm64 config digest and the
# arm64 manifest digest, both read out of the archive rather than out of the
# node we are about to assert against.
PLATFORM="${PLATFORM:-}"
resolve_platform() {
  [[ -n "$PLATFORM" ]] && return 0
  case "$(uname -m)" in
    aarch64|arm64) PLATFORM="linux/arm64" ;;
    x86_64|amd64)  PLATFORM="linux/amd64" ;;
    *) harness_error "cannot map $(uname -m) to a container platform — set PLATFORM=linux/<arch>" ;;
  esac
}

# Prints the config digest and the platform manifest digest of a saved archive,
# one per line. Either is a legitimate identity for the same single-platform
# image; which one the CRI reports as imageID varies by runtime version, and
# both discriminate old from new, so AC20 accepts either and prints both.
archive_identities() {
  local tarball="$1" plat="$2"
  python3 - "$tarball" "$plat" <<'PY'
import json, sys, tarfile
tar_path, plat = sys.argv[1], sys.argv[2]
arch = plat.split("/")[1]
out = []
with tarfile.open(tar_path) as t:
    m = json.load(t.extractfile("manifest.json"))
    out.append("sha256:" + m[0]["Config"].rsplit("/", 1)[-1].removesuffix(".json"))
    try:
        idx = json.load(t.extractfile("index.json"))
        for entry in idx.get("manifests", []):
            p = entry.get("platform") or {}
            if p.get("architecture") == arch and p.get("os") == "linux":
                out.append(entry["digest"])
    except KeyError:
        pass
print("\n".join(out))
PY
}

# Side-loads $ref and sets $2 (a variable name) to its accepted identities.
load_image() {
  local ref="$1" outvar="$2"
  if ! docker image inspect "$ref" >/dev/null 2>&1; then
    info "$(ts) Pulling $ref ($PLATFORM)"
    docker pull --platform "$PLATFORM" "$ref" >/dev/null || harness_error "cannot pull $ref"
  fi
  local tarball
  tarball="${RUN_DIR}/$(tr -c 'a-zA-Z0-9._-' '_' <<< "$ref").tar"
  info "$(ts) Saving $ref ($PLATFORM) and loading it into kind/${CLUSTER_NAME}"
  docker save --platform "$PLATFORM" -o "$tarball" "$ref" \
    || harness_error "docker save --platform ${PLATFORM} failed for ${ref} (docker >= 28 required)"
  kind load image-archive "$tarball" --name "$CLUSTER_NAME" >/dev/null \
    || harness_error "kind load image-archive failed for $ref"
  local ids
  ids="$(archive_identities "$tarball" "$PLATFORM")"
  [[ -n "${ids//[[:space:]]/}" ]] || harness_error "could not read any image identity out of ${tarball}"
  printf -v "$outvar" '%s' "$ids"
  rm -f "$tarball"
}

load_images() {
  resolve_platform
  load_image "${IMAGE_REPO}:${OLD_TAG}" OLD_IMAGE_ID
  load_image "${IMAGE_REPO}:${NEW_TAG}" NEW_IMAGE_ID
  [[ "$OLD_IMAGE_ID" != "$NEW_IMAGE_ID" ]] \
    || harness_error "old and new tags resolve to the SAME image identity (${OLD_IMAGE_ID}) — the upgrade would change nothing"
  info "old ${OLD_TAG} accepted identities: $(tr '\n' ' ' <<< "$OLD_IMAGE_ID")"
  info "new ${NEW_TAG} accepted identities: $(tr '\n' ' ' <<< "$NEW_IMAGE_ID")"

  # Keeper's init container and (on the existing-secret path) the preflight Job
  # pull from the network; side-load them so the run is offline and the pull
  # never eats an activeDeadlineSeconds budget.
  local aux auxtar
  for aux in busybox:1.37.0 "${PREFLIGHT_IMAGE:-alpine/k8s:1.30.0}"; do
    docker image inspect "$aux" >/dev/null 2>&1 \
      || docker pull --platform "$PLATFORM" "$aux" >/dev/null 2>&1 || true
    auxtar="${RUN_DIR}/$(tr -c 'a-zA-Z0-9._-' '_' <<< "$aux").tar"
    if docker save --platform "$PLATFORM" -o "$auxtar" "$aux" >/dev/null 2>&1; then
      kind load image-archive "$auxtar" --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
      rm -f "$auxtar"
    fi
  done
}

install_at_tag() {
  local tag="$1"; shift
  helm_install \
    -f "$VALUES" \
    --set "replicas=${REPLICAS}" \
    --set "image.tag=${tag}" \
    "$@"
}

# D5: the chart is identical on both sides; image.tag is the ONLY thing that
# changes, so the experiment isolates the binary rather than the chart.
upgrade_to_tag() {
  local tag="$1"; shift
  hc upgrade "$RELEASE" "$CHART_DIR" \
    -f "$VALUES" \
    --set "replicas=${REPLICAS}" \
    --set "image.tag=${tag}" \
    --wait --timeout "${TIMEOUT}s" \
    "$@"
}

wait_topology_ready() {
  if [[ "$REPLICAS" -gt 1 ]]; then
    wait_pod_ready "app.kubernetes.io/name=${KEEPER_STS}" "$TIMEOUT"
  fi
  local pod
  for pod in $(ch_pods); do wait_ch_ready "$pod"; done
}

# ─── AC7 — void rule ─────────────────────────────────────────────────────────
# Split into two halves on purpose, and the split is a declared divergence from
# the plan's single AC7 paragraph.
#
#   ac7a runs after EVERY install and EVERY upgrade, including the old-tag side.
#   ac7b runs only where the NEW binary is expected. The old build renders no
#   <user_directories> element at all (that absence is the P1.2 finding), so
#   running the merged-config half against it would abort the run as void
#   before the experiment starts, and would report the thing under test as a
#   harness defect.

ac7a_replicated_mode() {
  local label="$1"
  ac "AC7a" "replicated mode is real — CH_REPLICATED on every pod (${label})"
  local pod val
  for pod in $(ch_pods); do
    measure "CH_REPLICATED on ${pod}" kc exec "$pod" -- printenv CH_REPLICATED
    val="$MEASURED"
    if [[ "$val" != "true" ]]; then
      void_abort "${pod}: CH_REPLICATED is '${val}', not 'true'. The replicated code path (render.go:70) does not run in this topology, so every replicated assertion below would pass vacuously. REPLICAS=${REPLICAS}."
    fi
  done
  pass "AC7a ${label}: CH_REPLICATED=true on all ${REPLICAS} pods"
}

ac7b_config_merged() {
  local label="$1"
  ac "AC7b" "the keeper-backed access config actually merged (${label})"
  local pod cfg
  for pod in $(ch_pods); do
    cfg="$(kc exec "$pod" -- cat /var/lib/clickhouse/preprocessed_configs/config.xml 2>&1)" || true
    echo -e "${CYAN}[MEASURED AC7b]${NC} $(ts) ${pod} preprocessed config, user_directories section:"
    printf '%s\n' "$cfg" | grep -A 12 '<user_directories' | sed 's/^/    | /' || echo "    | <no user_directories element>"
    [[ -n "${cfg//[[:space:]]/}" ]] \
      || ac_fail "${pod}: preprocessed config capture is EMPTY (plan §5.2)"
    grep -qE '<user_directories[^>]+replace=' <<< "$cfg" \
      || ac_fail "${pod}: merged config has no <user_directories> carrying a replace attribute"
    grep -q '<replicated>' <<< "$cfg" \
      || ac_fail "${pod}: merged config has no <replicated> user directory"
    grep -q '<zookeeper_path>/clickhouse/langwatch/access/</zookeeper_path>' <<< "$cfg" \
      || ac_fail "${pod}: replicated user directory does not point at /clickhouse/langwatch/access/"
    if grep -q '<local_directory>' <<< "$cfg"; then
      ac_fail "${pod}: default <local_directory> survived the merge — @replace did not take effect"
    fi
    pass "AC7b ${pod} applied the keeper-backed access configuration"
  done
}

# ─── AC20 — the running image is the image we built ──────────────────────────
# Local form of AC20: kind side-loads, there is no registry in the loop, so the
# comparison is against the local image id rather than a registry digest. The
# crane/manifest-list form (a scratch tag pulled from a registry, where a pod may
# report the arm64 child rather than the list digest) belongs to the EKS legs.
ac20_image_digest() {
  local expected_ids="$1" label="$2"
  ac "AC20" "every pod runs the image we loaded (${label})"
  info "accepted identities: $(tr '\n' ' ' <<< "$expected_ids")"
  local pod actual id hit matched=0
  for pod in $(all_image_pods); do
    measure "imageID on ${pod}" \
      kc get pod "$pod" -o jsonpath='{.status.containerStatuses[0].imageID}'
    actual="$MEASURED"
    hit=""
    while IFS= read -r id; do
      [[ -n "$id" ]] || continue
      if [[ "$actual" == *"${id#sha256:}"* ]]; then hit="$id"; break; fi
    done <<< "$expected_ids"
    if [[ -n "$hit" ]]; then
      matched=$((matched + 1))
      pass "AC20 ${pod} runs ${hit}"
    else
      ac_fail "${pod}: imageID '${actual}' matches none of the identities of the image we loaded: $(tr '\n' ' ' <<< "$expected_ids"). If these are merely different digest forms of the same image, that is a comparison to FIX, not a result to skip."
    fi
  done
  [[ "$matched" -gt 0 ]] || ac_fail "no pods were checked — the digest comparison measured nothing"
}

# ─── Entity capture ──────────────────────────────────────────────────────────
# Five classes, one query each. Deterministic ordering so captures diff cleanly;
# the plan's exact SELECT * forms are additionally printed as raw evidence where
# they add anything (row policies, named collections).

CLASSES="user grant policy profile collection"

entity_query() {
  case "$1" in
    user)       echo "SHOW USERS" ;;
    grant)      echo "SHOW GRANTS FOR ${PROBE_USER}" ;;
    policy)     echo "SELECT concat(short_name, ' ON ', database, '.', table) FROM system.row_policies ORDER BY 1" ;;
    profile)    echo "SHOW PROFILES" ;;
    collection) echo "SELECT name FROM system.named_collections ORDER BY 1" ;;
    *)          harness_error "unknown entity class: $1" ;;
  esac
}

# Captures all five classes on every pod into <outdir>/<pod>.<class>.
# Each capture is printed verbatim. A class whose capture command could not run
# at all is a failure; an EMPTY class is recorded and left to the caller, since
# absence is a legitimate finding for the characterisation ACs (§5.2).
capture_entities() {
  local outdir="$1" label="$2"
  mkdir -p "$outdir"
  local pod cls out rc
  for pod in $(ch_pods); do
    for cls in $CLASSES; do
      rc=0
      out="$(ch_query "$pod" "$(entity_query "$cls")" 2>&1 | sort)" || rc=$?
      printf '%s\n' "$out" > "${outdir}/${pod}.${cls}"
      echo -e "${CYAN}[MEASURED ${CURRENT_AC}]${NC} $(ts) ${label} ${cls} on ${pod} (rc=${rc}) — \$ ${cls}: $(entity_query "$cls")"
      if [[ -z "${out//[[:space:]]/}" ]]; then
        echo "    | <empty>"
      else
        printf '%s\n' "$out" | sed 's/^/    | /'
      fi
    done
  done
  # Plan-verbatim supplementary evidence. Recorded, never used for the diff:
  # SELECT * column sets and secret visibility differ between the two binaries.
  local first_pod
  first_pod="$(ch_pods | head -1)"
  measure_allow_empty "${label} raw SELECT * FROM system.row_policies on ${first_pod}" \
    ch_query "$first_pod" "SELECT * FROM system.row_policies FORMAT Vertical"
  measure_allow_empty "${label} raw SELECT * FROM system.named_collections on ${first_pod}" \
    ch_query "$first_pod" "SELECT * FROM system.named_collections FORMAT Vertical"
}

# Records the outcome for every class on every pod, per §5.2, and returns the
# verdict rather than deciding it: "present everywhere", "absent everywhere",
# or "DIVERGENT". Divergence is a bug, not a finding (AC8(i)).
classify_capture() {
  local dir="$1" cls="$2"
  local pod present=0 absent=0
  for pod in $(ch_pods); do
    if grep -q "$(probe_marker "$cls")" "${dir}/${pod}.${cls}" 2>/dev/null; then
      present=$((present + 1))
    else
      absent=$((absent + 1))
    fi
  done
  if [[ "$present" -eq "$REPLICAS" ]]; then echo "present-on-all"
  elif [[ "$absent" -eq "$REPLICAS" ]]; then echo "absent-on-all"
  else echo "DIVERGENT(present=${present},absent=${absent})"
  fi
}

probe_marker() {
  case "$1" in
    user)       echo "$PROBE_USER" ;;
    grant)      echo "GRANT SELECT ON up.events TO ${PROBE_USER}" ;;
    policy)     echo "up_probe_policy" ;;
    profile)    echo "up_probe_profile" ;;
    collection) echo "up_probe_collection" ;;
  esac
}

# ─── P1.2 — install the OLD tag and settle the "before" cell ─────────────────

p1_2_install_old() {
  phase "P1.2 — install ${IMAGE_REPO}:${OLD_TAG} at replicas=${REPLICAS}"
  install_at_tag "$OLD_TAG"
  wait_topology_ready
  pass "helm install at ${OLD_TAG}"

  OLD_REVISION="$(hc history "$RELEASE" -o json | grep -o '"revision":[0-9]*' | tail -1 | cut -d: -f2)"
  info "old-tag helm revision: ${OLD_REVISION:-unknown}"

  ac7a_replicated_mode "after install at ${OLD_TAG}"

  ac "P1.2" "before-state of the access store on the old binary"
  local pod
  for pod in $(ch_pods); do
    # §1(b) "before" cell: the old build renders no <user_directories>, so the
    # server falls through to its default local_directory on the PVC. This is
    # the observation that settles E7, which the plan marks INFERRED.
    measure "ls -la /var/lib/clickhouse/access/ on ${pod}" \
      kc exec "$pod" -- ls -la /var/lib/clickhouse/access/
    measure "grep -c user_directories in preprocessed config on ${pod}" \
      kc exec "$pod" -- sh -c "grep -c user_directories /var/lib/clickhouse/preprocessed_configs/config.xml || true"
    # The count above is NOT on its own the discriminator, and reading it as one
    # would misreport the finding: ClickHouse ships its own default
    # <user_directories> element, so the old binary — which renders none of its
    # own (E6) — still counts 2 (open + close tag). What separates "server
    # default" from "chart-rendered" is the body: a default carries
    # <local_directory>, a chart render carries <replicated> and a replace
    # attribute. Both are captured verbatim so the before-state is readable
    # rather than inferred.
    measure "grep -c local_directory in preprocessed config on ${pod}" \
      kc exec "$pod" -- sh -c "grep -c local_directory /var/lib/clickhouse/preprocessed_configs/config.xml || true"
    measure "user_directories section verbatim on ${pod}" \
      kc exec "$pod" -- sh -c "grep -A 12 '<user_directories' /var/lib/clickhouse/preprocessed_configs/config.xml || echo '<no user_directories element>'"
    # Where the entities actually live on the old binary. `storage:` is the
    # column that settles E7 without inference: local_directory means the PVC.
    measure_allow_empty "access-entity storage backend on ${pod}" \
      ch_query "$pod" "SELECT DISTINCT storage FROM system.row_policies UNION DISTINCT SELECT DISTINCT storage FROM system.users"
  done
  measure_allow_empty "old-binary access store in Keeper (expected absent)" \
    ch_query "$(ch_pods | head -1)" \
    "SELECT count() FROM system.zookeeper WHERE path = '/clickhouse/langwatch/access'"
  pass "P1.2 before-state recorded on all ${REPLICAS} pods"
}

# ─── P1.3 — seed the five entity classes ─────────────────────────────────────

p1_3_seed() {
  phase "P1.3 — seed five entity classes and record a non-empty baseline"
  local pod0
  pod0="$(ch_pods | head -1)"

  ac "P1.3" "seed data tables"
  if [[ "$REPLICAS" -gt 1 ]]; then
    ch_query "$pod0" "CREATE DATABASE IF NOT EXISTS up ON CLUSTER langwatch"
    ch_query "$pod0" "
      CREATE TABLE IF NOT EXISTS up.events ON CLUSTER langwatch (ts DateTime, msg String)
      ENGINE=ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}')
      ORDER BY ts"
    ch_query "$pod0" "
      CREATE TABLE IF NOT EXISTS up.secrets ON CLUSTER langwatch (ts DateTime, msg String)
      ENGINE=ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}')
      ORDER BY ts"
  else
    ch_query "$pod0" "CREATE DATABASE IF NOT EXISTS up"
    ch_query "$pod0" "CREATE TABLE IF NOT EXISTS up.events (ts DateTime, msg String) ENGINE=MergeTree() ORDER BY ts"
    ch_query "$pod0" "CREATE TABLE IF NOT EXISTS up.secrets (ts DateTime, msg String) ENGINE=MergeTree() ORDER BY ts"
  fi
  ch_query "$pod0" "INSERT INTO up.events VALUES (now(), 'visible-to-probe'), (now(), 'admin-only')"
  ch_query "$pod0" "INSERT INTO up.secrets VALUES (now(), 'off-limits')"
  measure "row count in up.events on ${pod0}" ch_query "$pod0" "SELECT count() FROM up.events"

  ac "P1.3" "seed the five access entity classes (plain SQL, no ON CLUSTER)"
  # Deliberately plain SQL: replication of access entities is the property under
  # test. ON CLUSTER would create each entity independently on every node and
  # pass even with the access storage misconfigured.
  ch_query "$pod0" "CREATE USER IF NOT EXISTS ${PROBE_USER} IDENTIFIED WITH sha256_password BY '${PROBE_PW}'"
  ch_query "$pod0" "GRANT SELECT ON up.events TO ${PROBE_USER}"
  ch_query "$pod0" "CREATE ROW POLICY IF NOT EXISTS up_probe_policy ON up.events USING msg = 'visible-to-probe' TO ${PROBE_USER}"
  # Row visibility is an OR over the permissive policies that apply to a user, so
  # once any policy exists on a table every uncovered user sees zero rows. Without
  # this counter-policy the probe policy would blank the admin too and the AC9
  # enforcement assertion could not tell the two users apart.
  ch_query "$pod0" "CREATE ROW POLICY IF NOT EXISTS up_probe_allow_others ON up.events USING 1 TO ALL EXCEPT ${PROBE_USER}"
  ch_query "$pod0" "CREATE SETTINGS PROFILE IF NOT EXISTS up_probe_profile SETTINGS max_threads = 3"
  ch_query "$pod0" "CREATE NAMED COLLECTION IF NOT EXISTS up_probe_collection AS k = 'v'"
  pass "P1.3 five entity classes seeded on ${pod0}"

  ac "P1.3" "baseline capture — must be non-empty on the seed pod (AC1, AC8)"
  capture_entities "${RUN_DIR}/baseline" "baseline@${OLD_TAG}"
  local cls verdict
  BASELINE_VERDICTS=""
  for cls in $CLASSES; do
    verdict="$(classify_capture "${RUN_DIR}/baseline" "$cls")"
    echo -e "${CYAN}[MEASURED P1.3]${NC} baseline verdict for class '${cls}': ${verdict}"
    BASELINE_VERDICTS+="${cls}=${verdict}"$'\n'
    # The gate here is "seeding worked", NOT "already replicated". The old build
    # renders no <user_directories> of its own, so every replica keeps a private
    # local_directory and a plain-SQL entity created on the seed pod is pod-local
    # by construction. That pre-upgrade divergence is the before-state this
    # experiment exists to characterise — gating on present-on-all would make
    # P1.3 unsatisfiable against the old tag at REPLICAS>1 and the whole ladder
    # unrunnable. AC8's post-upgrade bar is UNCHANGED: present on EVERY pod, any
    # divergence a FAIL, asserted in p1_4_upgrade.
    if ! grep -q "$(probe_marker "$cls")" "${RUN_DIR}/baseline/${pod0}.${cls}" 2>/dev/null; then
      ac_fail "baseline for entity class '${cls}' is absent on the seed pod ${pod0} (distribution verdict '${verdict}') — seeding itself failed, so every downstream assertion would be measuring nothing"
    fi
  done
  pass "P1.3 baseline non-empty on seed pod ${pod0} for all five classes"

  ac "P1.3" "baseline distribution across replicas — old-binary before-state (recorded, not gated)"
  printf '%s' "$BASELINE_VERDICTS" | sed 's/^/    | /'
  printf '%s' "$BASELINE_VERDICTS" > "${RUN_DIR}/baseline-verdicts.txt"

  ac "AC18" "capture clusterSecret before the upgrade"
  measure "clusterSecret before upgrade" \
    kc get secret "$FULLNAME" -o jsonpath='{.data.clusterSecret}'
  CLUSTER_SECRET_BEFORE="$MEASURED"
}

# ─── AC12 — the mixed-version window ─────────────────────────────────────────

start_probe_client() {
  kc get pod "$PROBE_CLIENT_POD" >/dev/null 2>&1 && return 0
  kc run "$PROBE_CLIENT_POD" \
    --image="${IMAGE_REPO}:${NEW_TAG}" \
    --image-pull-policy=Never \
    --restart=Never \
    --command -- sleep infinity >/dev/null
  kc wait pod "$PROBE_CLIENT_POD" --for=condition=Ready --timeout=180s >/dev/null \
    || harness_error "AC12 probe client pod never became Ready"
}

# One sample line: <epoch>|<query rc>|<terminating yes/no>|<distinct imageIDs>|<ready ch pods>
ac12_sample() {
  local log="$1"
  local now rc=0 terminating="no" distinct ready
  now="$(date -u +%s)"
  kc exec "$PROBE_CLIENT_POD" -- clickhouse-client \
    --host "$FULLNAME" --password "$ADMIN_PW" \
    -q "SELECT count() FROM up.events" >/dev/null 2>&1 || rc=$?
  kc get pods -o wide 2>/dev/null | grep -q 'Terminating' && terminating="yes"
  distinct="$(kc get pods -l "app.kubernetes.io/name=${FULLNAME}" \
    -o jsonpath='{range .items[*]}{.status.containerStatuses[0].imageID}{"\n"}{end}' 2>/dev/null \
    | sort -u | grep -c . || true)"
  ready="$(kc get pods -l "app.kubernetes.io/name=${FULLNAME}" \
    -o jsonpath='{range .items[*]}{.status.phase}{"\n"}{end}' 2>/dev/null \
    | grep -c Running || true)"
  echo "${now}|${rc}|${terminating}|${distinct}|${ready}" >> "$log"
}

ac12_analyse() {
  local log="$1"
  ac "AC12" "the mixed-version window answers queries inside a bounded envelope"
  measure "AC12 sample log (epoch|queryRC|terminating|distinctImageIDs|readyPods)" cat "$log"

  local mixed last_terminating=0 epoch rc term dist
  mixed="$(awk -F'|' '$4 >= 2' "$log" | wc -l | tr -d ' ')"
  ac_assert_eq "samples observing 2+ distinct imageIDs (a genuinely mixed window)" \
    "$([[ "$mixed" -ge 1 ]] && echo yes || echo no)" "yes"

  while IFS='|' read -r epoch rc term dist _; do
    [[ -n "$epoch" ]] || continue
    if [[ "$term" == "yes" ]]; then last_terminating="$epoch"; fi
    if [[ "$rc" != "0" ]]; then
      if [[ "$term" == "yes" ]]; then continue; fi
      if [[ "$last_terminating" -ne 0 ]] \
         && [[ $((epoch - last_terminating)) -le "$AC12_RECOVERY_S" ]]; then
        continue
      fi
      ac_fail "distributed query failed at epoch ${epoch} with no pod Terminating and more than ${AC12_RECOVERY_S}s after the last Terminating sample (distinct imageIDs=${dist}). AC12's envelope permits failure only inside the rolling window."
    fi
  done < "$log"
  pass "AC12 every query failure fell inside the permitted rolling-restart envelope"
}

# ─── AC8 / AC9 / AC22 / AC23 / AC18 / AC26 ───────────────────────────────────

ac8_five_classes() {
  ac "AC8" "five entity classes survive the upgrade on every pod"
  require_all_pods_ready
  capture_entities "${RUN_DIR}/post-upgrade" "post-upgrade@${NEW_TAG}"
  local cls verdict
  for cls in $CLASSES; do
    verdict="$(classify_capture "${RUN_DIR}/post-upgrade" "$cls")"
    echo -e "${CYAN}[MEASURED AC8]${NC} post-upgrade verdict for class '${cls}': ${verdict}"
    case "$verdict" in
      present-on-all)
        pass "AC8 class '${cls}' present on all ${REPLICAS} pods" ;;
      absent-on-all)
        ac_fail "class '${cls}' was LOST on every replica across the upgrade. Total loss is a legitimate FINDING under §5.2 — and it FAILS AC8. Baseline capture: ${RUN_DIR}/baseline, post-upgrade capture: ${RUN_DIR}/post-upgrade" ;;
      *)
        ac_fail "class '${cls}' is ${verdict} — silent divergence across replicas. AC8(i): a class present on some replicas and absent on others is a BUG, not a finding." ;;
    esac
  done

  # Diff the deterministic captures pod by pod. A class that is present but
  # changed shape (a grant silently narrowed, a policy re-scoped) is not caught
  # by presence alone.
  local pod
  for pod in $(ch_pods); do
    for cls in $CLASSES; do
      measure_allow_empty "diff baseline vs post-upgrade, ${cls} on ${pod}" \
        diff -u "${RUN_DIR}/baseline/${pod}.${cls}" "${RUN_DIR}/post-upgrade/${pod}.${cls}"
      if [[ "$MEASURED_RC" -ne 0 ]]; then
        warn "AC8: ${cls} on ${pod} differs from baseline — recorded above verbatim"
      fi
    done
  done
}

ac9_enforcement() {
  ac "AC9" "enforcement still functions post-upgrade on a pod that never ran the DDL"
  local target
  target="$(ch_pods | tail -1)"
  measure "admin row count on ${target}" ch_query "$target" "SELECT count() FROM up.events"
  local admin_count="$MEASURED"
  measure "probe-user row count on ${target}" probe_query "$target" "SELECT count() FROM up.events"
  local probe_count="$MEASURED"
  ac_assert_eq "admin sees both rows on ${target}" "$admin_count" "2"
  ac_assert_eq "row policy limits ${PROBE_USER} to one row on ${target}" "$probe_count" "1"
}

ac22_absence_with_positive_control() {
  ac "AC22" "the seeded user still LACKS privileges (positive control first)"
  local target
  target="$(ch_pods | tail -1)"

  # Positive control FIRST. Without it this AC passes precisely when the upgrade
  # destroyed the user it claims to be testing.
  measure "positive control — ${PROBE_USER} authenticates and runs SELECT 1 on ${target}" \
    probe_query "$target" "SELECT 1"
  ac_assert_eq "positive control: ${PROBE_USER} SELECT 1" "$MEASURED" "1"

  local case_label
  for case_label in "access_management:CREATE USER up_denied_probe IDENTIFIED WITH no_password" \
                    "out_of_scope_read:SELECT count() FROM up.secrets"; do
    local name="${case_label%%:*}" query="${case_label#*:}"
    measure_allow_empty "denial case '${name}' for ${PROBE_USER} on ${target}" \
      probe_query "$target" "$query"
    local err="$MEASURED"
    if [[ "$MEASURED_RC" -eq 0 ]]; then
      ac_fail "denial case '${name}' SUCCEEDED — ${PROBE_USER} is not denied. Output: ${err}"
    fi
    [[ -n "${err//[[:space:]]/}" ]] \
      || ac_fail "denial case '${name}' produced an EMPTY error (plan §5.2) — a silent denial is not evidence of enforcement"
    if grep -qE 'AUTHENTICATION_FAILED|Code: 516|UNKNOWN_USER' <<< "$err"; then
      ac_fail "denial case '${name}' returned an authentication/unknown-user error, not ACCESS_DENIED. A permission error from a nonexistent user is not evidence of enforcement. Verbatim: ${err}"
    fi
    ac_assert_contains "denial case '${name}' names ACCESS_DENIED" "$err" "ACCESS_DENIED"
    ac_assert_contains "denial case '${name}' pins error code 497" "$err" "Code: 497"
  done
}

ac18_cluster_secret() {
  ac "AC18" "clusterSecret is byte-identical across the upgrade"
  measure "clusterSecret after upgrade" \
    kc get secret "$FULLNAME" -o jsonpath='{.data.clusterSecret}'
  local after="$MEASURED"
  [[ -n "${CLUSTER_SECRET_BEFORE//[[:space:]]/}" ]] \
    || ac_fail "clusterSecret BEFORE was never captured — nothing to compare against"
  if [[ "$after" != "$CLUSTER_SECRET_BEFORE" ]]; then
    ac_fail "clusterSecret CHANGED across the upgrade. before='${CLUSTER_SECRET_BEFORE}' after='${after}'. Inter-node auth is broken cluster-wide while SHOW USERS on pod-0 still looks perfect."
  fi
  pass "AC18 clusterSecret byte-identical across the upgrade"

  # --dry-run=server, never plain --dry-run: plain --dry-run is client-side in
  # Helm 3, `lookup` returns empty, the chart mints a fresh randAlphaNum 48, and
  # the resulting mismatch is an artifact of the flag rather than a defect. For
  # the same reason `helm template` is EXPECTED to differ.
  measure "clusterSecret under helm upgrade --dry-run=server" \
    sh -c "helm --kube-context '${KUBE_CTX}' -n '${NAMESPACE}' upgrade '${RELEASE}' '${CHART_DIR}' -f '${VALUES}' --set replicas=${REPLICAS} --set image.tag=${NEW_TAG} --dry-run=server 2>/dev/null | grep -m1 'clusterSecret:' | awk '{print \$2}' | tr -d '\"'"
  ac_assert_eq "clusterSecret under --dry-run=server matches the live Secret" \
    "$MEASURED" "$CLUSTER_SECRET_BEFORE"
}

ac23_propagation_bound() {
  ac "AC23" "propagation converges inside an enforced bound (PROPAGATION_TIMEOUT_S=${PROPAGATION_TIMEOUT_S})"
  if [[ "$PROPAGATION_TIMEOUT_S" -gt "$PROPAGATION_CAP_S" ]]; then
    ac_fail "PROPAGATION_TIMEOUT_S=${PROPAGATION_TIMEOUT_S} exceeds the AC23 cap of ${PROPAGATION_CAP_S}s. A self-chosen threshold with no cap is satisfiable by writing 600."
  fi
  local pod0 probe_name start elapsed worst=0 other seen
  pod0="$(ch_pods | head -1)"
  probe_name="up_prop_$(date -u +%s)"
  start="$(date -u +%s)"
  ch_query "$pod0" "CREATE USER ${probe_name} IDENTIFIED WITH no_password"
  for other in $(ch_pods | tail -n +2); do
    seen=""
    while :; do
      elapsed=$(( $(date -u +%s) - start ))
      seen="$(ch_query "$other" "SELECT count() FROM system.users WHERE name = '${probe_name}'" 2>/dev/null || echo "")"
      echo "    | $(ts) t+${elapsed}s ${other}: system.users count for ${probe_name} = '${seen:-<error>}'"
      [[ "$seen" == "1" ]] && break
      if [[ "$elapsed" -ge "$PROPAGATION_TIMEOUT_S" ]]; then
        ch_query "$pod0" "DROP USER IF EXISTS ${probe_name}" >/dev/null 2>&1 || true
        ac_fail "${other} did not see ${probe_name} within the enforced bound of ${PROPAGATION_TIMEOUT_S}s (elapsed ${elapsed}s). Last measured value: '${seen:-<error>}'."
      fi
      sleep 1
    done
    [[ "$elapsed" -gt "$worst" ]] && worst="$elapsed"
    pass "AC23 ${other} converged in ${elapsed}s"
  done
  ch_query "$pod0" "DROP USER IF EXISTS ${probe_name}" >/dev/null 2>&1 || true
  info "AC23 worst measured propagation: ${worst}s (bound ${PROPAGATION_TIMEOUT_S}s, cap ${PROPAGATION_CAP_S}s)"
}

restart_counts() {
  kc get pods -l "app.kubernetes.io/name=${FULLNAME}" \
    -o jsonpath='{range .items[*]}{.metadata.name}={.status.containerStatuses[0].restartCount}{"\n"}{end}' | sort
}

ac26_idempotency() {
  ac "AC26" "replicated idempotency — a second identical upgrade is a no-op"
  measure "restart counts before the second upgrade" restart_counts
  local restarts_before="$MEASURED"

  upgrade_to_tag "$NEW_TAG" || ac_fail "the second, identical helm upgrade FAILED"
  wait_topology_ready

  measure "restart counts after the second upgrade" restart_counts
  local restarts_after="$MEASURED"
  if [[ "$restarts_after" != "$restarts_before" ]]; then
    ac_fail "the second identical upgrade re-rolled the StatefulSet. before:
${restarts_before}
after:
${restarts_after}
That is a FAIL, not a cosmetic difference: it means every upgrade is two rolling restarts."
  fi
  pass "AC26 no pod restarts beyond the first pass"

  capture_entities "${RUN_DIR}/post-second" "post-second-upgrade@${NEW_TAG}"
  local pod cls
  for pod in $(ch_pods); do
    for cls in $CLASSES; do
      measure_allow_empty "diff first vs second upgrade pass, ${cls} on ${pod}" \
        diff -u "${RUN_DIR}/post-upgrade/${pod}.${cls}" "${RUN_DIR}/post-second/${pod}.${cls}"
      if [[ "$MEASURED_RC" -ne 0 ]]; then
        ac_fail "a second identical upgrade changed entity class '${cls}' on ${pod} — duplicated or drifted access entities. Diff printed verbatim above."
      fi
    done
  done
  pass "AC26 no duplicated or drifted access entities after the second pass"
}

# ─── P1.4 — the upgrade ──────────────────────────────────────────────────────

p1_4_upgrade() {
  phase "P1.4 — upgrade to ${IMAGE_REPO}:${NEW_TAG}, changing ONLY image.tag (D5)"

  # AC24(a): drop one seeded entity so the harness must go red. Without a
  # negative control a green run is indistinguishable from a harness that
  # asserts nothing.
  if [[ -n "${NEGATIVE_CONTROL_DROP_ENTITY:-}" ]]; then
    warn "AC24(a) NEGATIVE CONTROL ACTIVE: dropping seeded entity class '${NEGATIVE_CONTROL_DROP_ENTITY}'."
    warn "This run MUST exit 30. A green exit here is a FAIL of AC24(a) itself."
    drop_seeded_entity "${NEGATIVE_CONTROL_DROP_ENTITY}"
  fi

  start_probe_client
  local ac12_log="${RUN_DIR}/ac12-samples.log"
  : > "$ac12_log"

  info "$(ts) starting helm upgrade in the background and sampling the rolling window (AC12)"
  upgrade_to_tag "$NEW_TAG" > "${RUN_DIR}/upgrade.log" 2>&1 &
  local upgrade_pid=$!
  while kill -0 "$upgrade_pid" 2>/dev/null; do
    ac12_sample "$ac12_log"
    sleep "$AC12_SAMPLE_INTERVAL_S"
  done
  local upgrade_rc=0
  wait "$upgrade_pid" || upgrade_rc=$?
  measure_allow_empty "helm upgrade output" cat "${RUN_DIR}/upgrade.log"
  [[ "$upgrade_rc" -eq 0 ]] || harness_error "helm upgrade to ${NEW_TAG} exited ${upgrade_rc} — see the output above"
  ac12_sample "$ac12_log"
  wait_topology_ready
  pass "helm upgrade to ${NEW_TAG}"

  ac7a_replicated_mode "after upgrade to ${NEW_TAG}"
  ac7b_config_merged "after upgrade to ${NEW_TAG}"
  ac20_image_digest "$NEW_IMAGE_ID" "after upgrade to ${NEW_TAG}"
  ac18_cluster_secret
  ac8_five_classes
  ac9_enforcement
  ac22_absence_with_positive_control
  [[ "$REPLICAS" -gt 1 ]] && ac12_analyse "$ac12_log"
  [[ "$REPLICAS" -gt 1 ]] && ac23_propagation_bound
  ac26_idempotency
}

drop_seeded_entity() {
  local cls="$1" pod0
  pod0="$(ch_pods | head -1)"
  case "$cls" in
    user)       ch_query "$pod0" "DROP USER IF EXISTS ${PROBE_USER}" ;;
    grant)      ch_query "$pod0" "REVOKE SELECT ON up.events FROM ${PROBE_USER}" ;;
    policy)     ch_query "$pod0" "DROP ROW POLICY IF EXISTS up_probe_policy ON up.events" ;;
    profile)    ch_query "$pod0" "DROP SETTINGS PROFILE IF EXISTS up_probe_profile" ;;
    collection) ch_query "$pod0" "DROP NAMED COLLECTION IF EXISTS up_probe_collection" ;;
    *)          harness_error "NEGATIVE_CONTROL_DROP_ENTITY='${cls}' is not one of: ${CLASSES}" ;;
  esac
  pass "AC24(a) dropped seeded entity class '${cls}'"
}

# ─── P1.5 — rollback, both paths ─────────────────────────────────────────────
# Characterisation-shaped (§5.2): the outcome per entity class is recorded with
# its command and verbatim output. Absence is a legitimate finding. An
# unrecorded class is not.

characterise_rollback() {
  local label="$1" outdir="$2"
  require_all_pods_ready
  capture_entities "$outdir" "$label"
  local cls verdict
  for cls in $CLASSES; do
    verdict="$(classify_capture "$outdir" "$cls")"
    echo -e "${CYAN}[MEASURED ${CURRENT_AC}]${NC} ${label} verdict for class '${cls}': ${verdict}"
    if [[ ! -s "${outdir}/$(ch_pods | head -1).${cls}" ]] \
       && [[ "$verdict" != "absent-on-all" ]]; then
      ac_fail "class '${cls}' was not recorded at all under ${label} — §5.2: an unrecorded class fails this AC"
    fi
  done

  # Both surfaces that matter for a rollback: the PVC directory the old binary
  # falls back to, and the Keeper subtree the new binary wrote.
  local pod
  for pod in $(ch_pods); do
    measure "PVC access directory on ${pod} (${label})" \
      kc exec "$pod" -- ls -la /var/lib/clickhouse/access/
  done
  measure_allow_empty "Keeper access subtree count (${label})" \
    ch_query "$(ch_pods | head -1)" \
    "SELECT count() FROM system.zookeeper WHERE path = '/clickhouse/langwatch/access'"
}

p1_5_rollback() {
  phase "P1.5 — rollback, both paths"

  ac "AC15a" "helm rollback to the old revision replays the stored manifests"
  measure "helm history before rollback" hc history "$RELEASE"
  hc rollback "$RELEASE" "${OLD_REVISION:-1}" --wait --timeout "${TIMEOUT}s" \
    || ac_fail "helm rollback to revision ${OLD_REVISION:-1} FAILED"
  wait_topology_ready
  ac7a_replicated_mode "after helm rollback"
  ac20_image_digest "$OLD_IMAGE_ID" "after helm rollback"
  CURRENT_AC="AC15a"
  characterise_rollback "AC15a (helm rollback)" "${RUN_DIR}/rollback-a"

  ac "AC15b" "helm upgrade back to the old tag re-runs the secret.yaml lookup"
  # Get back onto the new tag first, so AC15b exercises new -> old through the
  # upgrade path rather than re-running an already-old release.
  CURRENT_AC="HARNESS"
  upgrade_to_tag "$NEW_TAG" >/dev/null || harness_error "could not return to ${NEW_TAG} before AC15b"
  wait_topology_ready
  ac "AC15b" "downgrade via helm upgrade --set image.tag=${OLD_TAG}"
  upgrade_to_tag "$OLD_TAG" || ac_fail "helm upgrade back to ${OLD_TAG} FAILED"
  wait_topology_ready
  ac7a_replicated_mode "after helm upgrade to ${OLD_TAG}"
  ac20_image_digest "$OLD_IMAGE_ID" "after helm upgrade to ${OLD_TAG}"
  CURRENT_AC="AC15b"
  characterise_rollback "AC15b (helm upgrade to old tag)" "${RUN_DIR}/rollback-b"

  measure "clusterSecret after the AC15b downgrade" \
    kc get secret "$FULLNAME" -o jsonpath='{.data.clusterSecret}'
  ac_assert_eq "clusterSecret survives the downgrade too" "$MEASURED" "$CLUSTER_SECRET_BEFORE"
}

# ─── P1.6 — Keeper quorum (AC19) ─────────────────────────────────────────────

p1_6_keeper_quorum() {
  phase "P1.6 — Keeper quorum loss is diagnosable and self-healing on a clock"
  if [[ "$REPLICAS" -le 1 ]]; then
    harness_error "P1.6 requires REPLICAS>1 — Keeper is not deployed at replicas=1"
  fi
  # Get back onto the new tag: with user_directories @replace'd, Keeper is the
  # only writable access directory. That coupling is what AC19 tests, and it
  # only exists on the new binary.
  upgrade_to_tag "$NEW_TAG" >/dev/null || harness_error "could not return to ${NEW_TAG} before AC19"
  wait_topology_ready

  ac "AC19" "below quorum: default still authenticates, the SQL user fails loudly"
  kc scale sts "$KEEPER_STS" --replicas=1
  kc rollout status sts "$KEEPER_STS" --timeout=180s || true
  sleep 10
  local target
  target="$(ch_pods | head -1)"

  # shellcheck disable=SC2016  # $(cat ...) is expanded inside the pod, not here
  measure "default (users.xml) still authenticates below quorum on ${target}" \
    timeout "$KEEPER_ERROR_TIMEOUT_S" env -u KUBECONFIG kubectl --context "$KUBE_CTX" -n "$NAMESPACE" \
      exec "$target" -- sh -c 'clickhouse-client --password "$(cat /mnt/secrets/password)" -q "SELECT 1"'
  ac_assert_eq "default authenticates below quorum" "$MEASURED" "1"

  measure_allow_empty "SQL user ${PROBE_USER} auth attempt below quorum (${KEEPER_ERROR_TIMEOUT_S}s budget)" \
    timeout "$KEEPER_ERROR_TIMEOUT_S" env -u KUBECONFIG kubectl --context "$KUBE_CTX" -n "$NAMESPACE" \
      exec "$target" -- clickhouse-client --user "$PROBE_USER" --password "$PROBE_PW" -q "SELECT 1"
  local probe_rc="$MEASURED_RC" probe_out="$MEASURED"
  if [[ "$probe_rc" -eq 124 ]]; then
    ac_fail "the ${PROBE_USER} auth attempt HUNG past ${KEEPER_ERROR_TIMEOUT_S}s below quorum. Without a clock a hang and a slow recovery are indistinguishable — AC19 requires a non-empty error carrying a code within a stated timeout."
  fi
  if [[ "$probe_rc" -ne 0 ]]; then
    [[ -n "${probe_out//[[:space:]]/}" ]] \
      || ac_fail "the ${PROBE_USER} auth attempt failed SILENTLY below quorum (empty result, rc=${probe_rc}). AC19 requires a non-empty ClickHouse error carrying an error code."
    ac_assert_contains "the below-quorum error carries a ClickHouse error code" "$probe_out" "Code:"
  else
    warn "AC19: ${PROBE_USER} still authenticated below quorum (rc=0). Recorded verbatim above — the expected behaviour is inferred and untested, which is why this is an AC."
  fi

  ac "AC19" "quorum restoration returns full function within ${KEEPER_RECOVERY_TIMEOUT_S}s, no manual step"
  kc scale sts "$KEEPER_STS" --replicas="$REPLICAS"
  wait_pod_ready "app.kubernetes.io/name=${KEEPER_STS}" "$TIMEOUT"
  local start elapsed out
  start="$(date -u +%s)"
  while :; do
    elapsed=$(( $(date -u +%s) - start ))
    out="$(probe_query "$target" "SELECT 1" 2>&1 || true)"
    echo "    | $(ts) t+${elapsed}s ${PROBE_USER} SELECT 1 -> '${out}'"
    [[ "$out" == "1" ]] && break
    if [[ "$elapsed" -ge "$KEEPER_RECOVERY_TIMEOUT_S" ]]; then
      ac_fail "${PROBE_USER} did not recover within ${KEEPER_RECOVERY_TIMEOUT_S}s of quorum restoration, with no manual step taken. Last observed: '${out}'."
    fi
    sleep 5
  done
  pass "AC19 full function returned ${elapsed}s after quorum restoration, no manual step"
}

# ─── P1.7 — the 1 -> 3 transition (AC11, AC25) ───────────────────────────────

p1_7_transition() {
  phase "P1.7 — the replicas 1 -> 3 transition (AC11 access, AC25 data)"
  if [[ "$REPLICAS" -le 1 ]]; then
    harness_error "P1.7 must be run with REPLICAS=3 — it installs at 1 and transitions to \$REPLICAS"
  fi
  purge_substrate

  CURRENT_AC="HARNESS"
  local target_replicas="$REPLICAS"
  REPLICAS=1
  install_at_tag "$NEW_TAG"
  wait_topology_ready
  p1_3_seed
  capture_entities "${RUN_DIR}/transition-before" "transition baseline @replicas=1"
  local pod0="${FULLNAME}-0"
  measure "row count in up.events at replicas=1" ch_query "$pod0" "SELECT count() FROM up.events"
  local rows_before="$MEASURED"

  CURRENT_AC="HARNESS"
  REPLICAS="$target_replicas"
  upgrade_to_tag "$NEW_TAG" || harness_error "the 1 -> ${REPLICAS} transition upgrade FAILED"
  wait_topology_ready

  ac "AC11" "entities seeded at replicas=1 are present on all pods, or verifiably absent"
  require_all_pods_ready
  capture_entities "${RUN_DIR}/transition-after" "transition post @replicas=${REPLICAS}"
  local cls verdict
  for cls in $CLASSES; do
    verdict="$(classify_capture "${RUN_DIR}/transition-after" "$cls")"
    echo -e "${CYAN}[MEASURED AC11]${NC} transition verdict for class '${cls}': ${verdict}"
    case "$verdict" in
      present-on-all|absent-on-all) pass "AC11 class '${cls}': ${verdict}" ;;
      *) ac_fail "class '${cls}' is ${verdict} across the transition — neither present on all pods nor verifiably absent" ;;
    esac
  done

  ac "AC25" "the transition does not silently lose table DATA"
  # Inferred model, refutable: the transition leaves existing tables as plain
  # MergeTree on pod-0 only, so pods 1..n start with empty data directories.
  # Equal per-pod counts, or a stable distributed count, REFUTE the model.
  local pod counts=""
  for pod in $(ch_pods); do
    measure_allow_empty "per-pod count() in up.events on ${pod}" ch_query "$pod" "SELECT count() FROM up.events"
    counts="${counts}${pod}=${MEASURED} "
  done
  info "AC25 prediction 1 (per-pod): expected ${rows_before} on pod-0 and 0 elsewhere. Measured: ${counts}"

  start_probe_client
  local i dist_counts=""
  for i in 1 2 3 4 5; do
    measure_allow_empty "distributed count() call #${i}" \
      kc exec "$PROBE_CLIENT_POD" -- clickhouse-client --host "$FULLNAME" --password "$ADMIN_PW" \
        -q "SELECT count() FROM up.events"
    dist_counts="${dist_counts}${MEASURED} "
  done
  info "AC25 prediction 2 (distributed, 5 calls): measured '${dist_counts}'"
  info "AC25 refutation clause: equal per-pod counts, or a stable distributed count, refute the MergeTree-on-pod-0 model. Both series are recorded above; the analysis is redone from observation before AC11-D is written."
  pass "AC25 both predictions measured and recorded (characterisation, §5.2)"
}

# ─── P1.8 — negative controls (AC24) ─────────────────────────────────────────

p1_8_negative_controls() {
  phase "P1.8 — negative controls (AC24)"

  ac "AC24(a)" "dropping one seeded entity makes the harness FAIL"
  # Run the AC8 check in a subshell after destroying one class. The subshell
  # must exit 30. A subshell that exits 0 means AC8 asserts nothing.
  ch_query "$(ch_pods | head -1)" "DROP SETTINGS PROFILE IF EXISTS up_probe_profile"
  info "dropped settings profile up_probe_profile; re-running the AC8 check, which MUST fail"
  local rc=0
  ( ac8_five_classes ) || rc=$?
  ac_assert_eq "AC24(a): the AC8 check exits 30 (AC failure) with an entity destroyed" "$rc" "30"
  ch_query "$(ch_pods | head -1)" "CREATE SETTINGS PROFILE IF NOT EXISTS up_probe_profile SETTINGS max_threads = 3"
  pass "AC24(a) the harness detects a dropped entity"

  ac "AC24(b)" "REPLICAS=1 aborts at the AC7 void rule"
  info "AC24(b) is a separate invocation, by construction: it needs a single-replica"
  info "cluster, which this run is not. Discharge it with:"
  info "    REPLICAS=1 make -C charts/clickhouse-serverless test-upgrade   # MUST exit 20"
  info "and record the [VOID] line naming CH_REPLICATED. A REPLICAS=1 run that exits 0"
  info "is a FAIL of AC24(b)."
}

# ─── Entry point ─────────────────────────────────────────────────────────────

usage() {
  sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'
  exit 40
}

require_tools() {
  local t
  for t in kind docker helm kubectl; do
    command -v "$t" >/dev/null 2>&1 || harness_error "required tool not found: ${t}"
  done
}

on_exit() {
  local rc=$?
  echo
  info "run artifacts (captures, AC12 samples, helm log): ${RUN_DIR}"
  cleanup_cluster
  exit "$rc"
}

main() {
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage
  case "$REPLICAS" in
    1|3) ;;
    *) echo "REPLICAS must be 1 or 3 (got '${REPLICAS}')" >&2; exit 40 ;;
  esac

  require_tools
  sep
  info "upgrade-access harness — langwatch-saas#1168"
  info "  REPLICAS=${REPLICAS}  ${OLD_TAG} -> ${NEW_TAG}  cluster=${CLUSTER_NAME}"
  info "  PHASES=${PHASES}"
  info "  PROPAGATION_TIMEOUT_S=${PROPAGATION_TIMEOUT_S} (AC23 cap ${PROPAGATION_CAP_S})"
  info "  artifacts: ${RUN_DIR}"
  if [[ "$REPLICAS" -eq 1 ]]; then
    warn "REPLICAS=1 is the AC24(b) NEGATIVE CONTROL. It must abort at the AC7 void"
    warn "rule naming CH_REPLICATED and exit 20. An exit of 0 is a FAIL of AC24(b)."
  fi

  trap on_exit EXIT
  setup_substrate
  load_images

  local p
  for p in $PHASES; do
    case "$p" in
      p1_2) p1_2_install_old ;;
      p1_3) p1_3_seed ;;
      p1_4) p1_4_upgrade ;;
      p1_5) p1_5_rollback ;;
      p1_6) p1_6_keeper_quorum ;;
      p1_7) p1_7_transition ;;
      p1_8) p1_8_negative_controls ;;
      *) echo "unknown phase '${p}' — valid: p1_2 p1_3 p1_4 p1_5 p1_6 p1_7 p1_8" >&2; exit 40 ;;
    esac
  done

  CURRENT_AC="HARNESS"
  sep
  pass "upgrade-access harness completed phases: ${PHASES}"
}

main "$@"
