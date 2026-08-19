#!/usr/bin/env bash
#
# Renders the chart and asserts that an upgrade of a local-filesystem install
# keeps the workers off the shared stored-objects volume while the app rolls.
#
# Why this matters. In local-filesystem mode the app Deployment and the workers
# Deployment mount the same ReadWriteOnce PVC. A ReadWriteOnce volume attaches
# to one node, so every consumer has to sit on that node. A helm upgrade rolls
# both Deployments at once and nothing orders them, so on a cluster with more
# than one node the new pod of one Deployment can be scheduled on a fresh node
# while the old pod of the other still holds the attachment on the old node.
# Both wedge in ContainerCreating with a multi-attach error (issue #7191).
#
# The chart answers with two hooks: a pre-upgrade Job that scales the workers to
# 0 and waits for their pods to go away, and a post-upgrade Job that stands them
# down again (helm's apply restores the count) until the app rollout finishes.
# Everything about them is a Go template over several values: which installs
# they render for, how long they wait, what they are allowed to touch. A gate
# written the wrong way round, a wait shorter than the workers' own shutdown
# budget, or an RBAC rule that grew wider are all invisible in the template
# source and visible only in the rendered output.
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
readonly APP_DEPLOYMENT="lw-app"
readonly PRE_JOB="lw-stored-objects-upgrade-pre"
readonly POST_JOB="lw-stored-objects-upgrade-post"

# The workers' default grace period. The waits have to outlast it, because a
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

# Prints the one document with a given metadata.name out of a hook block on
# stdin. The two Jobs share a kind, so the name is what tells them apart.
hook_doc_named() {
  awk -v want="$1" '
    /^# Source: / {
      if (name == want) { printf "%s", buf }
      buf = ""; name = ""; next
    }
    /^  name: / && name == "" { name = $2 }
    { buf = buf $0 "\n" }
    END { if (name == want) printf "%s", buf }
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
    fail "$label" "the upgrade hooks rendered where no volume is shared"
    return
  fi
  echo "ok   [$label] no upgrade hooks rendered"
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
  local block pre app_block workers_block
  block=$(hook_block "")
  if [ -z "$block" ]; then
    fail "default hook" "the default local-filesystem install rendered no upgrade hooks"
    return
  fi

  pre=$(printf '%s\n' "$block" | hook_doc_named "$PRE_JOB")
  if [ -z "$pre" ]; then
    fail "default hook" "the hooks rendered no ${PRE_JOB} Job"
    return
  fi
  expect_contains "default hook" "$pre" "helm.sh/hook: pre-upgrade" || return 0

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
  job_weight=$(printf '%s\n' "$pre" | awk -F'"' '/helm.sh\/hook-weight/ { print $2; exit }')
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
  local pre
  pre=$(hook_block "" | hook_doc_named "$PRE_JOB")

  # The scale target, the count, and the wait all have to name the workers.
  # Asserting only that the script says "replicas":0 would pass just as happily
  # if it scaled the app.
  expect_contains "scale and wait" "$pre" "deploy=\"${WORKERS_DEPLOYMENT}\"" || return 0
  expect_contains "scale and wait" "$pre" '--subresource=scale' || return 0
  expect_contains "scale and wait" "$pre" 'scale_workers 0' || return 0
  expect_contains "scale and wait" "$pre" '--for=delete pod' || return 0
  expect_contains "scale and wait" "$pre" \
    "selector=\"app.kubernetes.io/name=${WORKERS_DEPLOYMENT},app.kubernetes.io/instance=lw\"" || return 0
  echo "ok   [scale and wait] the pre-upgrade Job scales ${WORKERS_DEPLOYMENT} to 0 and waits for its pods to be deleted"
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
  job=$(hook_block "$flags" | hook_doc_named "$PRE_JOB")
  if [ -z "$job" ]; then
    fail "$label" "rendered no ${PRE_JOB} Job"
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

# @scenario "The workers come back only after the app pod that holds the volume is running"
test_workers_come_back_after_the_app_rollout() {
  local block post replicas app_wait deadline
  block=$(hook_block "")
  post=$(printf '%s\n' "$block" | hook_doc_named "$POST_JOB")
  if [ -z "$post" ]; then
    fail "post hook" "the hooks rendered no ${POST_JOB} Job"
    return
  fi
  expect_contains "post hook" "$post" "helm.sh/hook: post-upgrade" || return 0

  # Stand the workers down again: helm's apply restored the count, and the new
  # workers pod can follow the still-terminating old app pod back to the node
  # the app is leaving.
  expect_contains "post hook" "$post" 'scale_workers 0' || return 0
  expect_contains "post hook" "$post" '--for=delete pod' || return 0

  # Wait for the app, by name, before giving the workers back.
  expect_contains "post hook" "$post" "app=\"${APP_DEPLOYMENT}\"" || return 0
  expect_contains "post hook" "$post" 'wait_for_app_rollout "$app_timeout"' || return 0

  # And then restore the count the release names, not a hardcoded 1.
  replicas=$(printf '%s' "$post" | awk -F'=' '/^ *replicas=/ { gsub(/ /, "", $2); print $2; exit }')
  if [ "$replicas" != "1" ]; then
    fail "post hook" "the post-upgrade Job restores '${replicas:-<absent>}' replicas, expected the chart's workers.replicaCount of 1"
    return
  fi
  expect_contains "post hook" "$post" 'scale_workers "$replicas"' || return 0

  # The Job deadline has to cover both waits, or it kills itself before it can
  # bring the workers back.
  app_wait=$(printf '%s' "$post" | awk -F'=' '/^ *app_timeout=/ { gsub(/ /, "", $2); print $2; exit }')
  deadline=$(deadline_seconds_of "$post")
  case "${app_wait}${deadline}" in
    '' | *[!0-9]*)
      fail "post hook" "the app wait or the deadline did not render as numbers (app '${app_wait:-<absent>}', deadline '${deadline:-<absent>}')"
      return
      ;;
  esac
  if [ "$deadline" -le "$app_wait" ]; then
    fail "post hook" "activeDeadlineSeconds is ${deadline}s, which cuts the ${app_wait}s app wait short"
    return
  fi
  echo "ok   [post hook] stands the workers down, waits up to ${app_wait}s for ${APP_DEPLOYMENT}, then restores ${replicas}"
}

# @scenario "An install with object storage gets no upgrade steps"
test_dataplane_renders_no_hook() {
  expect_no_hook "dataplane" "$DATAPLANE"
  # Anchor the reason: with S3 active there is no stored-objects PVC either, so
  # nothing is shared and nothing needs ordering. Matched by template source,
  # because the bundled datastores render PersistentVolumeClaims of their own.
  local out
  out=$(render "$DATAPLANE")
  expect_absent "dataplane" "$out" "$STORED_OBJECTS_PVC_TEMPLATE" || return 0
  echo "ok   [dataplane] no stored-objects PVC and no hooks"
}

# @scenario "An install without workers gets no upgrade steps"
test_no_workers_renders_no_hook() {
  expect_no_hook "workers off" "--set workers.enabled=false"
}

# @scenario "An operator can turn the upgrade steps off"
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

# @scenario "The steps may touch only the two Deployments and the pods beside them"
test_hook_rbac_is_scoped() {
  local block role
  block=$(hook_block "")
  role=$(printf '%s\n' "$block" | hook_doc Role)
  if [ -z "$role" ]; then
    fail "rbac scope" "the hooks rendered no Role"
    return
  fi

  # Namespaced only. A ClusterRole here would hand the hooks every namespace.
  expect_absent "rbac scope" "$block" "kind: ClusterRole" || return 0
  expect_absent "rbac scope" "$block" "kind: ClusterRoleBinding" || return 0

  # Named targets. Without resourceNames the hooks could scale any Deployment
  # in the namespace.
  expect_contains "rbac scope" "$role" "resourceNames: [\"${WORKERS_DEPLOYMENT}\", \"${APP_DEPLOYMENT}\"]" || return 0
  expect_contains "rbac scope" "$role" "resourceNames: [\"${WORKERS_DEPLOYMENT}\"]" || return 0
  local named_rules
  named_rules=$(printf '%s\n' "$role" | grep -c 'resourceNames:' || true)
  if [ "$named_rules" -ne 2 ]; then
    fail "rbac scope" "expected both Deployment rules to name their targets, found ${named_rules} resourceNames"
    return
  fi

  # Write access is the workers' scale subresource only. A patch on
  # `deployments` itself could rewrite the image or the environment, and the app
  # Deployment must not be writable at all.
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
  echo "ok   [rbac scope] a namespaced Role: get on both Deployments, patch on the workers' scale, read on pods"
}

# @scenario "A first install is not blocked by the steps"
test_hook_is_upgrade_only_and_tolerates_a_missing_deployment() {
  local block pre post guard_exit
  block=$(hook_block "")
  pre=$(printf '%s\n' "$block" | hook_doc_named "$PRE_JOB")
  post=$(printf '%s\n' "$block" | hook_doc_named "$POST_JOB")

  # pre-install would run these on a fresh install, where there is no old pod
  # holding the volume and no Deployment to scale.
  expect_absent "first install" "$block" "pre-install" || return 0
  expect_absent "first install" "$block" "post-install" || return 0

  # ArgoCD and Flux map these phases to PreSync and PostSync and run them on the
  # first sync anyway, so both scripts have to leave without an error.
  local job label
  for label in pre post; do
    if [ "$label" = "pre" ]; then job="$pre"; else job="$post"; fi
    expect_contains "first install" "$job" 'if ! deployment_exists; then' || return 0
    guard_exit=$(printf '%s\n' "$job" | awk '/deployment_exists; then/ { want=1 } want && /^ *exit / { print $2; exit }')
    if [ "$guard_exit" != "0" ]; then
      fail "first install" "the ${label} Job must exit 0 when the Deployment is missing, it exits '${guard_exit:-<absent>}'"
      return
    fi
  done
  echo "ok   [first install] upgrade phases only, and both Jobs exit 0 when the Deployment is missing"
}

# @scenario "A slow or broken app never leaves the workers switched off"
test_post_hook_restores_workers_even_when_the_app_is_slow() {
  local post tail_of_script
  post=$(hook_block "" | hook_doc_named "$POST_JOB")

  # The wait is wrapped in an if/else that reports the problem and carries on,
  # rather than exiting. The scale back up therefore runs on both branches.
  expect_contains "post hook resilience" "$post" 'if wait_for_app_rollout "$app_timeout"; then' || return 0
  expect_contains "post hook resilience" "$post" 'Bringing the workers back anyway' || return 0

  # Nothing between the wait and the scale-up may exit, or a slow app would
  # leave the workers at 0.
  tail_of_script=$(printf '%s\n' "$post" | awk '/waiting up to %ss for the %s rollout/ { want=1 } want && /scale_workers "\$replicas"/ { exit } want { print }')
  if [ -z "$tail_of_script" ]; then
    fail "post hook resilience" "could not find the rollout wait ahead of the scale back up"
    return
  fi
  expect_absent "post hook resilience" "$tail_of_script" "exit 1" || return 0
  echo "ok   [post hook resilience] a rollout that does not finish warns and still brings the workers back"
}

# @scenario "A failed step does not block the next upgrade"
test_failed_hook_does_not_block_the_next_upgrade() {
  local block policies
  block=$(hook_block "")
  policies=$(printf '%s\n' "$block" | grep 'helm.sh/hook-delete-policy' | sort -u)
  if [ -z "$policies" ]; then
    fail "delete policy" "the hooks declare no hook-delete-policy, so a failed Job blocks the next upgrade with AlreadyExists"
    return
  fi
  # Every document needs it, not just one of the five.
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
test_workers_come_back_after_the_app_rollout
test_dataplane_renders_no_hook
test_no_workers_renders_no_hook
test_knob_off_renders_no_hook
test_hook_rbac_is_scoped
test_hook_is_upgrade_only_and_tolerates_a_missing_deployment
test_post_hook_restores_workers_even_when_the_app_is_slow
test_failed_hook_does_not_block_the_next_upgrade

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all stored-objects-upgrade-ordering assertions passed"
