#!/usr/bin/env bash
#
# Asserts the SHAPE of the chart e2e workflow (.github/workflows/langwatch-chart.yml)
# and of e2e.sh's argument parsing. These are CI invariants with no cluster to
# prove them: the matrix legs, their independence, the single shared image
# build, and the rule that every suite on main runs in exactly one leg. A suite
# dropped from every leg, a re-introduced fail-fast, or a continue-on-error
# would otherwise surface only as a missing [PASS] line nobody counted, 35
# minutes into an e2e run.
#
# Runs in the render job of the chart workflow (no cluster, seconds). It reads
# the workflow YAML with python3 + PyYAML rather than yq: both are on the
# GitHub-hosted runner, but only python3+PyYAML is also present in the dev
# environment where these scripts are verified with `bash -n` / shellcheck, so
# this stays runnable end to end before it is pushed.
#
# Scenario bindings use the same `@scenario` token as the other suites here,
# expressed as a hash-comment above the test function it verifies — the next
# line that is neither blank nor a comment must be that function. See
# specs/charts/ci-lifecycle.feature.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHART_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CHART_DIR/../.." && pwd)"
E2E="$SCRIPT_DIR/e2e.sh"
WORKFLOW="$REPO_ROOT/.github/workflows/langwatch-chart.yml"

failures=0
ok()   { echo "ok   [$1] $2"; }
bad()  { echo "FAIL [$1] $2" >&2; failures=$((failures + 1)); }

# Facts about the workflow, computed once. Each line is `key<TAB>value`; the
# python reads the file, PyYAML turns `on:` into the boolean key True (harmless,
# we only read `jobs`), and we emit exactly the facts the scenarios assert.
WF_FACTS="$(python3 - "$WORKFLOW" <<'PY'
import re, sys, yaml

with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f)

jobs = doc["jobs"]
e2e = jobs["e2e"]
legs = e2e["strategy"]["matrix"]["include"]

def emit(k, v):
    print(f"{k}\t{v}")

# Leg names and per-leg clusters.
names = sorted(l["name"] for l in legs)
clusters = [l["cluster"] for l in legs]
emit("leg_names", " ".join(names))
emit("distinct_cluster_count", len(set(clusters)))
emit("leg_count", len(legs))

# Fail isolation: fail-fast must be off and nothing may be continue-on-error.
emit("failfast", e2e["strategy"].get("fail-fast"))

def count_coe(node):
    n = 0
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "continue-on-error":
                n += 1
            n += count_coe(v)
    elif isinstance(node, list):
        for v in node:
            n += count_coe(v)
    return n
emit("continue_on_error_count", count_coe(doc))

# The e2e legs depend on the shared image build.
needs = e2e.get("needs", [])
if isinstance(needs, str):
    needs = [needs]
emit("e2e_needs", " ".join(sorted(needs)))

# One build-images job that publishes each image once; the e2e legs must not
# rebuild — they only load. Count upload-artifact steps in build-images and any
# `docker build` in the e2e steps.
bi = jobs["build-images"]
uploads = sum(
    1 for s in bi["steps"]
    if isinstance(s.get("uses"), str) and "upload-artifact" in s["uses"]
)
emit("build_images_upload_count", uploads)
e2e_docker_build = sum(
    1 for s in e2e["steps"]
    if isinstance(s.get("run"), str) and "docker build" in s["run"]
)
emit("e2e_docker_build_count", e2e_docker_build)

# Every leg must either load the app image (needs_app) or declare it unneeded
# (skip_app_build). A leg that does neither makes e2e.sh rebuild the app image,
# the most expensive one, on every run.
app_unprovisioned = sum(
    1 for l in legs
    if not l.get("needs_app") and not l.get("skip_app_build")
)
emit("app_unprovisioned_legs", app_unprovisioned)

# The suite step (the one that runs matrix.script / e2e.sh, where every suite
# executes) must exist exactly once and run unconditionally. Counting only the
# `if:` keys would also pass if the step were removed entirely, so emit the
# step count too. An `if:` on it would silently drop a whole leg's suites — the
# same "optional suite" failure continue-on-error causes. Counted on the e2e
# job's steps only; the job-level draft gate `if:` is not a step.
def runs_suite_script(run):
    # An unconditional, unmasked invocation. After dropping blank and comment
    # lines the block must be exactly one line, and that line must be exactly
    # the invocation (optional `./path` prefix, then `${{ matrix.script }}`,
    # nothing after but whitespace). This rejects `${{ matrix.script }} || true`,
    # a trailing second command, or a preceding `set +e` — each of which would
    # let a failing suite pass unnoticed. A commented-out invocation never
    # counts.
    meaningful = [
        line.strip() for line in run.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    return (
        len(meaningful) == 1
        and re.match(r'^(\./\S*)?\$\{\{\s*matrix\.script\s*\}\}\s*$', meaningful[0])
        is not None
    )

suite_steps = [
    s for s in e2e["steps"]
    if isinstance(s.get("run"), str) and runs_suite_script(s["run"])
]
emit("suite_step_count", len(suite_steps))
suite_step_if = sum(1 for s in suite_steps if "if" in s)
emit("suite_step_if_count", suite_step_if)

# The suites each leg runs, parsed from `E2E_SUITES="..."` in its script. Legs
# without it (overlays) contribute none.
union = []
duplicated = False
seen = set()
for l in legs:
    m = re.search(r'E2E_SUITES="([^"]*)"', l.get("script", ""))
    if not m:
        continue
    for suite in m.group(1).split():
        if suite in seen:
            duplicated = True
        seen.add(suite)
        union.append(suite)
emit("suites_union", " ".join(sorted(set(union))))
emit("suites_duplicated", "yes" if duplicated else "no")
PY
)"

fact() { printf '%s\n' "$WF_FACTS" | awk -F'\t' -v k="$1" '$1==k{print $2}'; }

# @scenario "e2e.sh runs exactly the suites named as arguments (tasks#894)"
test_e2e_runs_exactly_the_named_suites() {
  local out
  # No arguments lists today's full order.
  out="$(bash "$E2E" --list | tr '\n' ' ')"
  out="${out% }"
  local full="test_install test_clickhouse test_clickhouse_url_secret test_postgresql test_redis test_resources test_app test_lwql test_workers test_metrics_collection test_upgrade_strategy_boundary test_upgrade test_external_clickhouse test_lwql_external_postgres_secret_guard test_cold_storage_and_backup"
  if [ "$out" = "$full" ]; then
    ok "argument parsing" "no args lists the full suite set in order"
  else
    bad "argument parsing" "no-arg --list was '$out', expected '$full'"
  fi

  # Named suites run in the given order, only those.
  out="$(bash "$E2E" --list test_upgrade test_install | tr '\n' ' ')"
  out="${out% }"
  if [ "$out" = "test_upgrade test_install" ]; then
    ok "argument parsing" "named suites list in the given order"
  else
    bad "argument parsing" "subset --list was '$out', expected 'test_upgrade test_install'"
  fi

  # An unknown suite is a hard error (exit 2), never a silent skip.
  local rc=0
  bash "$E2E" --list not_a_suite >/dev/null 2>&1 || rc=$?
  if [ "$rc" = "2" ]; then
    ok "argument parsing" "an unknown suite exits 2"
  else
    bad "argument parsing" "unknown suite exited $rc, expected 2"
  fi
}

# @scenario "The chart e2e runs core, external and overlays as independent matrix legs (tasks#894)"
test_e2e_runs_independent_matrix_legs() {
  local names clusters legs
  names="$(fact leg_names)"
  clusters="$(fact distinct_cluster_count)"
  legs="$(fact leg_count)"
  if [ "$names" = "core external overlays" ]; then
    ok "matrix legs" "legs are core, external, overlays"
  else
    bad "matrix legs" "legs are '$names', expected 'core external overlays'"
  fi
  if [ "$clusters" = "$legs" ] && [ "$legs" = "3" ]; then
    ok "matrix legs" "each of the 3 legs has its own kind cluster"
  else
    bad "matrix legs" "$legs legs but $clusters distinct clusters (expected 3 == 3)"
  fi
}

# @scenario "A failing suite in one e2e leg does not stop the other legs (tasks#894)"
test_failing_leg_does_not_stop_the_others() {
  local ff
  ff="$(fact failfast)"
  # PyYAML renders the boolean as `False`.
  if [ "$ff" = "False" ]; then
    ok "fail isolation" "strategy.fail-fast is false"
  else
    bad "fail isolation" "strategy.fail-fast is '$ff', expected False"
  fi
}

# @scenario "One build-images job builds each image once and the e2e legs load them (tasks#894)"
test_images_are_built_once_and_reused() {
  local uploads rebuilds needs unprovisioned
  uploads="$(fact build_images_upload_count)"
  rebuilds="$(fact e2e_docker_build_count)"
  needs="$(fact e2e_needs)"
  unprovisioned="$(fact app_unprovisioned_legs)"
  if [ "$uploads" = "3" ]; then
    ok "image reuse" "build-images publishes 3 image artifacts"
  else
    bad "image reuse" "build-images has $uploads upload-artifact steps, expected 3"
  fi
  if [ "$rebuilds" = "0" ]; then
    ok "image reuse" "the e2e legs rebuild no image (load only)"
  else
    bad "image reuse" "the e2e legs run $rebuilds 'docker build' step(s), expected 0"
  fi
  if [ "$needs" = "build-images render" ]; then
    ok "image reuse" "e2e depends on build-images and render"
  else
    bad "image reuse" "e2e needs are '$needs', expected 'build-images render'"
  fi
  if [ "$unprovisioned" = "0" ]; then
    ok "image reuse" "every leg loads the app image or sets skip_app_build"
  else
    bad "image reuse" "$unprovisioned leg(s) neither load the app image nor set skip_app_build"
  fi
}

# @scenario "Every suite that runs on main runs in exactly one e2e leg (tasks#894)"
test_every_main_suite_runs_in_exactly_one_leg() {
  local union full dup
  union="$(fact suites_union)"
  dup="$(fact suites_duplicated)"
  # The full main list, sorted, is what --list prints sorted.
  full="$(bash "$E2E" --list | sort | tr '\n' ' ')"
  full="${full% }"
  if [ "$union" = "$full" ]; then
    ok "suite coverage" "core+external cover every suite that runs on main"
  else
    bad "suite coverage" "leg suites '$union' != main suites '$full'"
  fi
  if [ "$dup" = "no" ]; then
    ok "suite coverage" "no suite appears in more than one leg"
  else
    bad "suite coverage" "a suite appears in more than one leg"
  fi
}

# @scenario "No e2e suite is skipped, gated, or made optional (tasks#894)"
test_no_suite_is_optional() {
  local coe
  coe="$(fact continue_on_error_count)"
  if [ "$coe" = "0" ]; then
    ok "no optional suite" "the workflow has no continue-on-error"
  else
    bad "no optional suite" "$coe continue-on-error key(s) in the workflow, expected 0"
  fi

  local suite_steps
  suite_steps="$(fact suite_step_count)"
  if [ "$suite_steps" = "1" ]; then
    ok "no optional suite" "exactly one e2e step runs the matrix suite script"
  else
    bad "no optional suite" "$suite_steps e2e steps run the matrix suite script, expected 1"
    return
  fi

  local suite_if
  suite_if="$(fact suite_step_if_count)"
  if [ "$suite_if" = "0" ]; then
    ok "no optional suite" "the suite step runs unconditionally (no if:)"
  else
    bad "no optional suite" "$suite_if if: key(s) on the e2e suite step, expected 0"
  fi
}

test_e2e_runs_exactly_the_named_suites
test_e2e_runs_independent_matrix_legs
test_failing_leg_does_not_stop_the_others
test_images_are_built_once_and_reused
test_every_main_suite_runs_in_exactly_one_leg
test_no_suite_is_optional

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures chart workflow-shape check(s) failed"
  exit 1
fi

echo
echo "all chart workflow-shape checks pass"
