#!/usr/bin/env bash
#
# Renders the chart and asserts the Helm LIFECYCLE invariants that a review bot
# kept finding by hand on langwatch/langwatch#8261 — every one of them provable
# from `helm template` in seconds, none needing a cluster (tasks#894, AC1).
#
# The five shapes this pins, each a P0/P2 finding that shipped and was caught
# only in review:
#
#   1. A hook Job's ServiceAccount, and every Secret it reads through a
#      secretKeyRef / envFrom.secretRef / volume, must itself be a hook that
#      runs in EVERY phase the Job runs in, at a STRICTLY LOWER hook-weight. A
#      main-phase dependency does not exist yet when the hook fires: Helm
#      applies hooks before the release, so the Job starts with no
#      ServiceAccount (falls back to `default`, wrong permissions) or a
#      secretKeyRef that resolves to nothing and the pod wedges in
#      CreateContainerConfigError. Invisible in the template source; visible
#      only in the rendered annotations.
#   2. Every hook resource that runs on `pre-upgrade` must also run on
#      `pre-rollback`. A rollback moves the release the same way an upgrade
#      does and Helm fires its own event pair for it; a hook registered for the
#      upgrade event alone simply does not run during a rollback, silently,
#      exactly when the operator is already recovering from a bad release.
#   3. No template may reference a `.Values.<path>` that `values.yaml` does not
#      declare. An undeclared path renders empty, so a Job reading
#      `.Values.global.imagePullSecrets` (never declared) pulls nothing and the
#      private image fails — and the source reads as if the value were wired.
#   4. No subchart mount may be delivered through a PARENT `extraVolumes` /
#      `extraVolumeMounts` list. Those lists belong to the parent's own
#      workloads; a subchart declares its own mounts from a typed value, and a
#      volume pushed onto the parent list never reaches the subchart's pod.
#
# The render covers install (`helm template`) and upgrade (`--is-upgrade`); the
# rollback assertion reads the hook annotations directly, because Helm has no
# rollback render flag. Assertions keep going after the first failure and every
# finding is printed, the way the render job's other suites do.
#
# Scenario bindings use the same `@scenario` token as the other suites in this
# directory, expressed as a hash-comment above the `test_<name>()` function it
# verifies. See specs/charts/ci-lifecycle.feature.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/lifecycle.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# ── Allowlist for the undeclared-values check (invariant 3) ──────────────────
# Each entry is a `.Values` path a template reads that values.yaml does not (and
# should not) declare, with the one-line reason it is exempt. Anything NOT here
# and NOT declared in values.yaml is a hard failure.
VALUES_ALLOWLIST=(
  # gateway.* is the langwatch-gateway SUBCHART's own values tree; the parent
  # reads gateway.ingress.host to derive the gateway public URL. Subchart values
  # are owned by the subchart and are not enumerated in the parent values.yaml.
  "gateway.ingress"
  # NOTES.txt display default only; the canonical ingress key is ingress.hosts
  # (a list). `.Values.ingress.host | default "<your-ingress-host>"` is a
  # human-facing placeholder in the post-install notes, not a wired value.
  "ingress.host"
)

# SUBCHARTS (the names that invariant 4 treats as subcharts) is derived from
# Chart.yaml below, after the PyYAML guard — see the derivation there.

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Chart dependencies must be built for the render to resolve the subcharts. CI
# builds them in a prior step; build them here too so a local run just works.
if ! ls charts/*.tgz >/dev/null 2>&1; then
  echo "info: building chart dependencies (charts/*.tgz absent)" >&2
  helm dependency build . >/dev/null 2>&1 || {
    echo "SETUP ERROR: helm dependency build failed" >&2
    exit 2
  }
fi

# PyYAML is the values/render parser. It ships with the GitHub ubuntu-latest
# Python; install it on demand rather than failing a local run that lacks it.
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  python3 -m pip install --quiet --disable-pip-version-check pyyaml >/dev/null 2>&1 || {
    echo "SETUP ERROR: python3 with PyYAML is required" >&2
    exit 2
  }
fi

# ── Subchart names for the parent-extraVolumes check (invariant 4) ───────────
# Read straight from Chart.yaml dependencies (the alias when set, else the name)
# so a newly added subchart is covered without editing this script. redis and
# postgresql are parent-managed StatefulSets, not subcharts, so their
# extraVolumes are the parent's own and are excluded by construction.
mapfile -t SUBCHARTS < <(python3 - <<'PYEOF'
import yaml
with open("Chart.yaml") as fh:
    chart = yaml.safe_load(fh) or {}
for dep in chart.get("dependencies", []) or []:
    print(dep.get("alias") or dep["name"])
PYEOF
)
if [ "${#SUBCHARTS[@]}" -eq 0 ]; then
  echo "SETUP ERROR: no dependencies found in Chart.yaml" >&2
  exit 2
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

readonly INSTALL_RENDER="$WORKDIR/install.yaml"
readonly UPGRADE_RENDER="$WORKDIR/upgrade.yaml"
readonly CHECKS="$WORKDIR/checks.py"

# Autogen so the chart's own secret validation lets a bare render through, the
# same base the sibling suites use. This default posture is where the
# stored-objects lifecycle hooks render.
readonly BASE="--set autogen.enabled=true"

# Render install and upgrade, aborting on a render error rather than letting an
# empty result read as "no hooks, all clear".
render_to() {
  local out="$1"
  shift
  local err="$WORKDIR/render.err"
  # shellcheck disable=SC2086
  if ! helm template lw . $BASE "$@" >"$out" 2>"$err"; then
    echo "RENDER ERROR (flags: $*):" >&2
    head -n 20 "$err" >&2
    exit 2
  fi
}

render_to "$INSTALL_RENDER"
render_to "$UPGRADE_RENDER" --is-upgrade

cat > "$CHECKS" <<'PYEOF'
"""Lifecycle invariants for the langwatch chart. See tests/lifecycle.sh."""
import glob
import os
import re
import sys

import yaml

HOOK = "helm.sh/hook"


def anns(doc):
    return ((doc.get("metadata") or {}).get("annotations") or {}) if isinstance(doc, dict) else {}


def load_docs(paths):
    docs = []
    for p in paths:
        with open(p) as fh:
            for d in yaml.safe_load_all(fh):
                if isinstance(d, dict) and d.get("kind"):
                    docs.append(d)
    return docs


def phases_of(doc):
    return set(x.strip() for x in (anns(doc).get(HOOK) or "").split(",") if x.strip())


def weight_of(doc):
    try:
        return int(anns(doc).get("helm.sh/hook-weight", "0"))
    except (TypeError, ValueError):
        return 0


def is_hook(doc):
    return bool(phases_of(doc))


def index(docs):
    """Map (kind, name) -> merged {phases, weight, hook} across renders."""
    idx = {}
    for d in docs:
        key = (d["kind"], (d.get("metadata") or {}).get("name"))
        entry = idx.setdefault(key, {"phases": set(), "weight": None, "hook": False})
        if is_hook(d):
            entry["hook"] = True
            entry["phases"] |= phases_of(d)
            entry["weight"] = weight_of(d)
        elif entry["weight"] is None:
            entry["weight"] = weight_of(d)
    return idx


def secret_names(job):
    spec = ((job.get("spec") or {}).get("template") or {}).get("spec") or {}
    out = set()
    for c in (spec.get("containers") or []) + (spec.get("initContainers") or []):
        for e in c.get("env") or []:
            ref = ((e.get("valueFrom") or {}).get("secretKeyRef") or {}).get("name")
            if ref:
                out.add(ref)
        for ef in c.get("envFrom") or []:
            ref = (ef.get("secretRef") or {}).get("name")
            if ref:
                out.add(ref)
    for v in spec.get("volumes") or []:
        ref = (v.get("secret") or {}).get("secretName")
        if ref:
            out.add(ref)
    return out


def sa_of(job):
    spec = ((job.get("spec") or {}).get("template") or {}).get("spec") or {}
    return spec.get("serviceAccountName")


def resolve_dep(idx, kind, name, job_phases, job_weight):
    """Report string for a hook Job's dependency: main-phase|weight N|phase-gap|missing|ok."""
    entry = idx.get((kind, name))
    if entry is None:
        return "missing"
    if not entry["hook"]:
        return "main-phase"
    if not job_phases <= entry["phases"]:
        gap = ",".join(sorted(job_phases - entry["phases"]))
        return "phase-gap:%s" % gap
    if entry["weight"] >= job_weight:
        return "weight %d" % entry["weight"]
    return "ok"


def check_hook_deps(kind_wanted):
    """kind_wanted: 'ServiceAccount' or 'Secret'.

    Each render (install, upgrade) is indexed and resolved on its OWN, never
    unioned: a dependency that is a hook in one render but main-phase or absent
    in the other is a real defect in that render, and merging the two would let
    the good render mask the bad one. The FAIL line carries the render it fired
    in, since the same Job can pass in one and fail in the other.
    """
    renders = [("install", sys.argv[2]), ("upgrade", sys.argv[3])]
    bad = 0
    checked = 0
    for render_name, path in renders:
        docs = load_docs([path])
        idx = index(docs)
        jobs = {}
        for d in docs:
            if d["kind"] == "Job" and is_hook(d):
                jobs[(d["metadata"]["name"], frozenset(phases_of(d)), weight_of(d))] = d
        for (jname, jphases, jweight), job in sorted(jobs.items()):
            if kind_wanted == "ServiceAccount":
                san = sa_of(job)
                needs = [] if not san or san == "default" else [san]
            else:
                needs = sorted(secret_names(job))
            for name in needs:
                checked += 1
                status = resolve_dep(idx, kind_wanted, name, set(jphases), jweight)
                phase = ",".join(sorted(jphases))
                if status != "ok":
                    print("FAIL [hook-dep]: render=%s job=%s phase=%s needs=%s/%s found=%s"
                          % (render_name, jname, phase, kind_wanted, name, status))
                    bad += 1
    if bad:
        return 1
    print("ok   [hook-%s] %d hook-Job %s dependencies (across install and upgrade) are lower-weight hooks covering every phase"
          % (kind_wanted.lower(), checked, kind_wanted))
    return 0


def check_pre_rollback():
    docs = load_docs([sys.argv[2], sys.argv[3]])
    seen = {}
    for d in docs:
        ph = phases_of(d)
        if not ph:
            continue
        seen.setdefault((d["kind"], d["metadata"]["name"]), set()).update(ph)
    bad = 0
    for (kind, name), ph in sorted(seen.items()):
        if "pre-upgrade" in ph and "pre-rollback" not in ph:
            print("FAIL [pre-rollback]: %s/%s runs on pre-upgrade (%s) but not pre-rollback"
                  % (kind, name, ",".join(sorted(ph))))
            bad += 1
    if bad:
        return 1
    print("ok   [pre-rollback] every pre-upgrade hook resource also runs on pre-rollback (%d hook resources)"
          % len(seen))
    return 0


REF = re.compile(r"\$?\.Values((?:\.[A-Za-z0-9_]+)+)")


def declared(values, path):
    """True if the dotted path resolves, OR any prefix is an empty map/list or a
    scalar (a free-form / opaque leaf such as annotations or global.scheduling)."""
    node = values
    for key in path:
        if isinstance(node, dict):
            if node == {}:
                return True
            if key in node:
                node = node[key]
                continue
            return False
        # a list or scalar reached before the path was consumed -> opaque leaf
        return True
    return True


def allowed(dotted, allow):
    """An allowlist entry exempts its exact path AND every path below it, so
    `gateway.ingress` also covers `gateway.ingress.host` — anything under a
    subchart-owned or notes-only subtree, not just the one dotted spelling."""
    for entry in allow:
        if dotted == entry or dotted.startswith(entry + "."):
            return True
    return False


def check_values():
    allow = set(sys.argv[2:])
    with open("values.yaml") as fh:
        values = yaml.safe_load(fh)
    bad = 0
    for f in sorted(glob.glob("templates/**/*", recursive=True)):
        if not os.path.isfile(f):
            continue
        with open(f, errors="replace") as fh:
            for i, line in enumerate(fh, 1):
                for m in REF.finditer(line):
                    path = m.group(1).lstrip(".").split(".")
                    dotted = ".".join(path)
                    if allowed(dotted, allow):
                        continue
                    if not declared(values, path):
                        print("FAIL [undeclared-value]: %s:%d references .Values.%s (not in values.yaml)"
                              % (f, i, dotted))
                        bad += 1
    if bad:
        return 1
    print("ok   [undeclared-value] every .Values path a template reads is declared in values.yaml")
    return 0


def check_subchart_mounts():
    subcharts = set(sys.argv[2:])
    files = sorted(set(
        glob.glob("values.yaml")
        + glob.glob("examples/*.yaml")
        + glob.glob("examples/overlays/*.yaml")
        + glob.glob("tests/values-*.yaml")
    ))
    bad = 0
    for f in files:
        with open(f) as fh:
            try:
                data = yaml.safe_load(fh)
            except yaml.YAMLError:
                continue
        if not isinstance(data, dict):
            continue
        for alias in subcharts:
            block = data.get(alias)
            if not isinstance(block, dict):
                continue
            for key in ("extraVolumes", "extraVolumeMounts"):
                val = block.get(key)
                if val:  # non-empty list/map
                    print("FAIL [subchart-mount]: %s sets %s.%s (%d entr%s) — a subchart mounts from its own typed value, not a parent list"
                          % (f, alias, key, len(val), "y" if len(val) == 1 else "ies"))
                    bad += 1
    if bad:
        return 1
    print("ok   [subchart-mount] no subchart receives a mount through a parent extraVolumes/extraVolumeMounts list")
    return 0


DISPATCH = {
    "hook-sa": lambda: check_hook_deps("ServiceAccount"),
    "hook-secret": lambda: check_hook_deps("Secret"),
    "pre-rollback": check_pre_rollback,
    "values": check_values,
    "subchart": check_subchart_mounts,
}

sys.exit(DISPATCH[sys.argv[1]]())
PYEOF

run_check() {
  # $1 label, rest: checks.py argv. Prints findings; bumps failures on nonzero.
  local label="$1"
  shift
  if ! python3 "$CHECKS" "$@"; then
    failures=$((failures + 1))
    echo "  (invariant '$label' failed)"
  fi
}

# @scenario "A hook Job's ServiceAccount is a lower-weight hook in every phase it runs (tasks#894)"
test_hook_service_account_is_a_lower_weight_hook() {
  run_check "hook-sa" hook-sa "$INSTALL_RENDER" "$UPGRADE_RENDER"
}

# @scenario "A hook Job's secret dependencies are lower-weight hooks in every phase it runs (tasks#894)"
test_hook_secret_refs_are_lower_weight_hooks() {
  run_check "hook-secret" hook-secret "$INSTALL_RENDER" "$UPGRADE_RENDER"
}

# @scenario "Every pre-upgrade hook resource also runs on pre-rollback (tasks#894)"
test_pre_upgrade_hooks_also_run_pre_rollback() {
  run_check "pre-rollback" pre-rollback "$INSTALL_RENDER" "$UPGRADE_RENDER"
}

# @scenario "No template references an undeclared .Values path (tasks#894)"
test_templates_reference_only_declared_values() {
  run_check "values" values "${VALUES_ALLOWLIST[@]}"
}

# @scenario "No subchart mount is delivered through a parent extraVolumes list (tasks#894)"
test_subchart_mounts_are_not_parent_extra_volumes() {
  run_check "subchart" subchart "${SUBCHARTS[@]}"
}

test_hook_service_account_is_a_lower_weight_hook
test_hook_secret_refs_are_lower_weight_hooks
test_pre_upgrade_hooks_also_run_pre_rollback
test_templates_reference_only_declared_values
test_subchart_mounts_are_not_parent_extra_volumes

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures lifecycle invariant(s) failed"
  exit 1
fi

echo "all lifecycle assertions passed"
