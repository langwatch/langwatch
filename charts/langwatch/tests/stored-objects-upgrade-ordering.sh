#!/usr/bin/env bash
#
# Renders the chart and asserts that an upgrade of a local-filesystem install
# moves ONE consumer of the stored-objects volume at a time.
#
# Why this matters. In local-filesystem mode the app Deployment and the workers
# Deployment mount the same ReadWriteOnce PVC. A ReadWriteOnce volume attaches
# to one node, so every consumer has to sit on that node. A helm upgrade rolls
# both Deployments at once and nothing orders them, so on a cluster with more
# than one node the new pod of one Deployment can be scheduled on a fresh node
# while the old pod of the other still holds the attachment on the old node.
# Both wedge in ContainerCreating with a multi-attach error (issue #7191).
#
# The chart answers with a pre-upgrade hook Job that scales the workers to 0 and
# waits for their pods to go away. Everything about that hook is a Go template
# over several values: which installs it renders for, how long it waits, what it
# is allowed to touch. A gate written the wrong way round, a wait shorter than
# the workers' own shutdown budget, or an RBAC rule that grew wider are all
# invisible in the template source and visible only in the rendered output.
# See specs/setup/helm-stored-objects-upgrade-ordering.feature.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies. The next
# line that is neither blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/stored-objects-upgrade-ordering.sh

set -euo pipefail

cd "$(dirname "$0")/.."

readonly HOOK_TEMPLATE="langwatch/templates/app/stored-objects-serialize-upgrade.yaml"
readonly STORED_OBJECTS_PVC_TEMPLATE="langwatch/templates/app/stored-objects-pvc.yaml"
readonly WORKERS_DEPLOYMENT="lw-workers"

# The workers' default grace period. The wait has to outlast it, because a
# terminating pod keeps its volume attached to its node until it is fully gone.
readonly DEFAULT_GRACE_SECONDS=55

# Secret autogen, so the chart's own secret validation lets a bare render
# through. Matches the other suites in this directory.
readonly BASE="--set autogen.enabled=true"

# Minimum flags that make S3 the active stored-objects backend.
readonly DATAPLANE="--set app.dataplane.enabled=true --set app.dataplane.s3.bucket=b --set app.dataplane.s3.region=eu-central-1"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Renders a profile, aborting on a render error rather than letting an empty
# result satisfy a "renders nothing" assertion.
render() {
  local out
  # shellcheck disable=SC2086
  if ! out=$(helm template lw . $BASE $1 2>&1); then
    echo "RENDER ERROR for flags '$1':" >&2
    printf '%s\n' "$out" | head -n 20 >&2
    exit 2
  fi
  printf '%s\n' "$out"
}

# Prints only the documents the hook template produced, so a value from another
# template can never satisfy an assertion.
hook_block() {
  render "$1" | awk -v want="$HOOK_TEMPLATE" '
    /^# Source: / { grab = ($3 == want) }
    grab { print }
  '
}

# Prints the one document of a given kind out of a hook block on stdin.
hook_doc() {
  awk -v want="$1" '
    /^# Source: / {
      if (kind == want) { printf "%s", buf }
      buf = ""; kind = ""; next
    }
    /^kind: / { kind = $2 }
    { buf = buf $0 "\n" }
    END { if (kind == want) printf "%s", buf }
  '
}

# Prints one component Deployment, the same way workers-shutdown.sh does.
render_component() {
  render "$2" | awk -v want="langwatch/templates/$1/deployment.yaml" '
    /^# Source: / { grab = ($3 == want) }
    grab { print }
  '
}

# Asserts a profile renders no hook at all, and says which profile.
expect_no_hook() {
  local label="$1" flags="$2" block
  block=$(hook_block "$flags")
  if [ -n "$block" ]; then
    fail "$label" "the pre-upgrade hook rendered where no volume is shared"
    return
  fi
  echo "ok   [$label] no pre-upgrade hook rendered"
}

expect_contains() {
  local label="$1" haystack="$2" needle="$3"
  case "$haystack" in
    *"$needle"*) return 0 ;;
  esac
  fail "$label" "expected to find: ${needle}"
  return 1
}

expect_absent() {
  local label="$1" haystack="$2" needle="$3"
  case "$haystack" in
    *"$needle"*)
      fail "$label" "must not contain: ${needle}"
      return 1
      ;;
  esac
  return 0
}

# @scenario "A local-filesystem install gets a pre-upgrade step"
test_default_install_renders_the_hook() {
  local block job app_block workers_block
  block=$(hook_block "")
  if [ -z "$block" ]; then
    fail "default hook" "the default local-filesystem install rendered no pre-upgrade hook"
    return
  fi

  job=$(printf '%s\n' "$block" | hook_doc Job)
  if [ -z "$job" ]; then
    fail "default hook" "the hook rendered no Job"
    return
  fi
  expect_contains "default hook" "$job" "helm.sh/hook: pre-upgrade" || return 0

  # The ordering claim, stated as the two facts a render can show: the Job is a
  # pre-upgrade hook (helm runs those before it applies anything), and neither
  # Deployment is a hook, so both are ordinary release resources that helm only
  # touches afterwards. The RBAC carries a lower weight than the Job, so the
  # ServiceAccount exists before the Job needs it.
  app_block=$(render_component "app" "")
  workers_block=$(render_component "workers" "")
  expect_absent "default hook" "$app_block" "helm.sh/hook" || return 0
  expect_absent "default hook" "$workers_block" "helm.sh/hook" || return 0

  local job_weight rbac_weight
  job_weight=$(printf '%s\n' "$job" | awk -F'"' '/helm.sh\/hook-weight/ { print $2; exit }')
  rbac_weight=$(printf '%s\n' "$block" | hook_doc Role | awk -F'"' '/helm.sh\/hook-weight/ { print $2; exit }')
  case "${job_weight}${rbac_weight}" in
    '' | *[!0-9-]*)
      fail "default hook" "hook weights did not render as numbers (Job '${job_weight:-<absent>}', Role '${rbac_weight:-<absent>}')"
      return
      ;;
  esac
  if [ "$rbac_weight" -ge "$job_weight" ]; then
    fail "default hook" \
      "the Role's weight (${rbac_weight}) must be below the Job's (${job_weight}), or the Job can start without its permissions"
    return
  fi
  echo "ok   [default hook] pre-upgrade Job at weight ${job_weight}, RBAC at ${rbac_weight}, Deployments are not hooks"
}

# @scenario "The pre-upgrade step scales the workers to zero and waits for the pods"
test_hook_scales_workers_to_zero_and_waits() {
  local job
  job=$(hook_block "" | hook_doc Job)

  # The scale target, the count, and the wait all have to name the workers.
  # Asserting only that the script says "replicas":0 would pass just as happily
  # if it scaled the app.
  expect_contains "scale and wait" "$job" "deploy=\"${WORKERS_DEPLOYMENT}\"" || return 0
  expect_contains "scale and wait" "$job" '--subresource=scale' || return 0
  expect_contains "scale and wait" "$job" '{"spec":{"replicas":0}}' || return 0
  expect_contains "scale and wait" "$job" '--for=delete pod' || return 0
  expect_contains "scale and wait" "$job" \
    "selector=\"app.kubernetes.io/name=${WORKERS_DEPLOYMENT},app.kubernetes.io/instance=lw\"" || return 0
  echo "ok   [scale and wait] the hook scales ${WORKERS_DEPLOYMENT} to 0 and waits for its pods to be deleted"
}

wait_seconds_of() {
  printf '%s' "$1" | awk -F'=' '/^ *timeout=/ { gsub(/ /, "", $2); print $2; exit }'
}

deadline_seconds_of() {
  printf '%s' "$1" | awk '/activeDeadlineSeconds:/ { print $2; exit }'
}

# Asserts one profile's wait outlasts the grace period that profile grants.
expect_wait_outlasts_grace() {
  local label="$1" flags="$2" grace="$3" job wait deadline
  job=$(hook_block "$flags" | hook_doc Job)
  if [ -z "$job" ]; then
    fail "$label" "rendered no hook Job"
    return
  fi
  wait=$(wait_seconds_of "$job")
  deadline=$(deadline_seconds_of "$job")
  case "${wait}" in
    '' | *[!0-9]*)
      fail "$label" "the wait did not render as a number (got '${wait:-<absent>}')"
      return
      ;;
  esac
  case "${deadline}" in
    '' | *[!0-9]*)
      fail "$label" "activeDeadlineSeconds did not render as a number (got '${deadline:-<absent>}')"
      return
      ;;
  esac
  if [ "$wait" -le "$grace" ]; then
    fail "$label" \
      "the hook waits ${wait}s, which does not outlast the ${grace}s the workers may take to exit"
    return
  fi
  # A deadline at or below the wait would kill the Job while the wait it was
  # sized for is still running, which reads as "the pods never went away".
  if [ "$deadline" -le "$wait" ]; then
    fail "$label" \
      "activeDeadlineSeconds is ${deadline}s, which cuts the ${wait}s wait short"
    return
  fi
  echo "ok   [$label] waits ${wait}s for a ${grace}s grace period, with a ${deadline}s Job deadline"
}

# @scenario "The wait outlasts the time the workers may take to shut down"
test_wait_outlasts_the_grace_period() {
  expect_wait_outlasts_grace "wait vs grace" "" "$DEFAULT_GRACE_SECONDS"
  # An operator who gives the workers a slower drain must not be left with a
  # wait sized for the old one.
  expect_wait_outlasts_grace "wait vs raised grace" \
    "--set workers.shutdownDrainSeconds=60 --set workers.terminationGracePeriodSeconds=120" \
    120
}

# @scenario "The workers come back at the replica count the release names"
test_workers_replicas_are_in_the_manifest() {
  local block replicas
  block=$(render_component "workers" "")
  replicas=$(printf '%s\n' "$block" | awk '/^  replicas:/ { print $2; exit }')
  case "$replicas" in
    '' | *[!0-9]*)
      fail "workers replicas" \
        "the workers Deployment does not name replicas (got '${replicas:-<absent>}'). The hook scales them to 0, and only a rendered replica count brings them back when helm applies the release."
      return
      ;;
  esac
  if [ "$replicas" -lt 1 ]; then
    fail "workers replicas" "the workers Deployment renders replicas: ${replicas}"
    return
  fi
  echo "ok   [workers replicas] the manifest names replicas: ${replicas}, so applying the release restores the count"
}

# @scenario "An install with object storage gets no pre-upgrade step"
test_dataplane_renders_no_hook() {
  expect_no_hook "dataplane" "$DATAPLANE"
  # Anchor the reason: with S3 active there is no stored-objects PVC either, so
  # nothing is shared and nothing needs ordering. Matched by template source,
  # because the bundled datastores render PersistentVolumeClaims of their own.
  local out
  out=$(render "$DATAPLANE")
  expect_absent "dataplane" "$out" "$STORED_OBJECTS_PVC_TEMPLATE" || return 0
  echo "ok   [dataplane] no stored-objects PVC and no hook"
}

# @scenario "An install without workers gets no pre-upgrade step"
test_no_workers_renders_no_hook() {
  expect_no_hook "workers off" "--set workers.enabled=false"
}

# @scenario "An operator can turn the pre-upgrade step off"
test_knob_off_renders_no_hook() {
  local flags="--set app.storedObjects.localFilesystem.serializeUpgrades=false"
  expect_no_hook "knob off" "$flags"
  # The knob orders the rollout, it does not change the storage mode: the PVC
  # and the workers' mount of it have to survive.
  local out workers_block
  out=$(render "$flags")
  expect_contains "knob off" "$out" "$STORED_OBJECTS_PVC_TEMPLATE" || return 0
  workers_block=$(render_component "workers" "$flags")
  expect_contains "knob off" "$workers_block" "claimName: lw-stored-objects" || return 0
  echo "ok   [knob off] the PVC and the workers' mount of it are unchanged"
}

# @scenario "The step may touch only the workers Deployment and the pods beside it"
test_hook_rbac_is_scoped() {
  local block role
  block=$(hook_block "")
  role=$(printf '%s\n' "$block" | hook_doc Role)
  if [ -z "$role" ]; then
    fail "rbac scope" "the hook rendered no Role"
    return
  fi

  # Namespaced only. A ClusterRole here would hand the hook every namespace.
  expect_absent "rbac scope" "$block" "kind: ClusterRole" || return 0
  expect_absent "rbac scope" "$block" "kind: ClusterRoleBinding" || return 0

  # Named target. Without resourceNames the hook could scale any Deployment in
  # the namespace, including the app it is supposed to leave alone.
  expect_contains "rbac scope" "$role" "resourceNames: [\"${WORKERS_DEPLOYMENT}\"]" || return 0
  local named_rules
  named_rules=$(printf '%s\n' "$role" | grep -c 'resourceNames:' || true)
  if [ "$named_rules" -ne 2 ]; then
    fail "rbac scope" "expected both Deployment rules to name ${WORKERS_DEPLOYMENT}, found ${named_rules} resourceNames"
    return
  fi

  # Write access is the scale subresource only. A patch on `deployments` itself
  # could rewrite the image or the environment.
  expect_contains "rbac scope" "$role" 'resources: ["deployments"]' || return 0
  expect_contains "rbac scope" "$role" 'resources: ["deployments/scale"]' || return 0
  local deployment_verbs scale_verbs pod_verbs
  deployment_verbs=$(printf '%s\n' "$role" | awk '/resources: \["deployments"\]/ { want=1 } want && /verbs:/ { print; exit }')
  scale_verbs=$(printf '%s\n' "$role" | awk '/resources: \["deployments\/scale"\]/ { want=1 } want && /verbs:/ { print; exit }')
  pod_verbs=$(printf '%s\n' "$role" | awk '/resources: \["pods"\]/ { want=1 } want && /verbs:/ { print; exit }')

  expect_contains "rbac scope" "$deployment_verbs" 'verbs: ["get"]' || return 0
  expect_contains "rbac scope" "$scale_verbs" 'verbs: ["get", "patch"]' || return 0
  expect_contains "rbac scope" "$pod_verbs" 'verbs: ["get", "list", "watch"]' || return 0

  # Nothing that can destroy or create work.
  local verb
  for verb in create delete deletecollection update; do
    expect_absent "rbac scope" "$role" "\"${verb}\"" || return 0
  done
  echo "ok   [rbac scope] a namespaced Role: get on ${WORKERS_DEPLOYMENT}, patch on its scale, read on pods"
}

# @scenario "A first install is not blocked by the step"
test_hook_is_upgrade_only_and_tolerates_a_missing_deployment() {
  local block job
  block=$(hook_block "")
  job=$(printf '%s\n' "$block" | hook_doc Job)

  # pre-install would run this on a fresh install, where there is no old pod
  # holding the volume and no Deployment to scale.
  expect_absent "first install" "$block" "pre-install" || return 0

  # ArgoCD and Flux map pre-upgrade to PreSync and run it on the first sync
  # anyway, so the script itself has to leave without an error.
  expect_contains "first install" "$job" 'if ! kubectl -n "$ns" get deployment "$deploy"' || return 0
  expect_contains "first install" "$job" 'nothing to stand down' || return 0
  local guard_exit
  guard_exit=$(printf '%s\n' "$job" | awk '/nothing to stand down/ { want=1 } want && /exit / { print $2; exit }')
  if [ "$guard_exit" != "0" ]; then
    fail "first install" "a missing Deployment must exit 0, the script exits '${guard_exit:-<absent>}'"
    return
  fi
  echo "ok   [first install] pre-upgrade only, and a missing Deployment exits 0"
}

# @scenario "A failed step does not block the next upgrade"
test_failed_hook_does_not_block_the_next_upgrade() {
  local block policies
  block=$(hook_block "")
  policies=$(printf '%s\n' "$block" | grep 'helm.sh/hook-delete-policy' | sort -u)
  if [ -z "$policies" ]; then
    fail "delete policy" "the hook declares no hook-delete-policy, so a failed Job blocks the next upgrade with AlreadyExists"
    return
  fi
  # Every document needs it, not just one of the four.
  local policy_count doc_count
  policy_count=$(printf '%s\n' "$block" | grep -c 'helm.sh/hook-delete-policy' || true)
  doc_count=$(printf '%s\n' "$block" | grep -c '^# Source: ' || true)
  if [ "$policy_count" -ne "$doc_count" ]; then
    fail "delete policy" "${doc_count} hook documents but only ${policy_count} carry a hook-delete-policy"
    return
  fi
  expect_contains "delete policy" "$policies" "before-hook-creation" || return 0
  # hook-failed would delete the evidence the operator needs to read.
  expect_absent "delete policy" "$policies" "hook-failed" || return 0
  echo "ok   [delete policy] all ${doc_count} hook documents replace themselves before the next attempt and keep a failed Job"
}

test_default_install_renders_the_hook
test_hook_scales_workers_to_zero_and_waits
test_wait_outlasts_the_grace_period
test_workers_replicas_are_in_the_manifest
test_dataplane_renders_no_hook
test_no_workers_renders_no_hook
test_knob_off_renders_no_hook
test_hook_rbac_is_scoped
test_hook_is_upgrade_only_and_tolerates_a_missing_deployment
test_failed_hook_does_not_block_the_next_upgrade

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all stored-objects-upgrade-ordering assertions passed"
