#!/usr/bin/env bash
#
# Asserts that rendering these charts never requires permissions an installer
# scoped to their own namespace would not have.
#
# Why this is a static check and not a render. `lookup` returns an empty result
# whenever the render has no cluster behind it, which is every `helm template`
# in CI and every GitOps dry run. A `lookup` the installer is FORBIDDEN to make
# behaves completely differently: Helm swallows only NotFound, so a 403 comes
# back as a template error and takes the whole install down —
#
#   Error: UPGRADE FAILED: template: langwatch/templates/NOTES.txt:102:11:
#   executing "langwatch/templates/NOTES.txt" at <lookup "node.k8s.io/v1"
#   "RuntimeClass" "" "">: error calling lookup: runtimeclasses.node.k8s.io is
#   forbidden: User "..." cannot list resource "runtimeclasses" in API group
#   "node.k8s.io" at the cluster scope
#
# — and a Go template has no way to recover. So the failure is invisible to
# every green `helm template` in the matrix and shows up only on a customer's
# locked-down cluster. Reading the templates is the only place to catch it.
#
# Scenario bindings use the same `@scenario` token as the other suites in this
# directory, expressed as a hash-comment above the test function it verifies.
# The next line that is neither blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   ./tests/restricted-rbac.sh

set -euo pipefail

cd "$(dirname "$0")/../.."

readonly CHARTS_DIR="$PWD"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Every template across every chart, so a chart added later is covered without
# anyone remembering to extend this list.
templates() {
  find "$CHARTS_DIR" -type d -name templates -not -path "*/charts/*/charts/*" \
    -exec find {} -type f \( -name "*.yaml" -o -name "*.tpl" -o -name "*.txt" \) \;
}

TEMPLATES=$(templates)
readonly TEMPLATES

# A guard that scans nothing passes silently, and every way this breaks — the
# script moving, a templates/ directory being renamed, the wrong cwd — produces
# exactly that. GNU xargs makes it worse than it looks: given empty input it
# still runs grep, with no file operands, so grep reads the already-drained
# stdin, finds nothing and reports success. Anchor on the file the whole rule
# exists for, so an empty corpus is a failure rather than a green tick.
readonly CORPUS_ANCHOR="charts/langwatch/templates/NOTES.txt"

if ! printf '%s\n' "$TEMPLATES" | grep -q "/${CORPUS_ANCHOR}\$"; then
  echo "FAIL [no-corpus]: did not find ${CORPUS_ANCHOR} under ${CHARTS_DIR}."
  echo "This guard scans by path, so an empty or wrong corpus makes it pass"
  echo "without checking anything. Has the script moved out of charts/*/tests/?"
  exit 1
fi

# A cluster-scoped lookup is one whose namespace argument is the empty string:
#   lookup "node.k8s.io/v1" "RuntimeClass" "" ""
# Namespaced lookups pass .Release.Namespace there and are fine — they need no
# permission the chart's own Secret reads do not already need.
#
# Limitation, deliberate: a namespace passed as a variable is not inspected.
# The point is to catch the literal that is easy to write without thinking,
# not to be a general analyzer.
readonly CLUSTER_SCOPED='lookup[[:space:]]+"[^"]*"[[:space:]]+"[^"]*"[[:space:]]+""'

# A CALL, not the word. Every real lookup names its apiVersion as a string
# literal, so `lookup "` is the call and `lookup` on its own is prose — the
# template comments explaining why this rule exists say the word repeatedly,
# and must not trip it.
readonly ANY_LOOKUP_CALL='lookup[[:space:]]+"'

# @scenario "A restricted installer can render the chart without cluster-scoped read access"
test_no_cluster_scoped_lookup() {
  local hits
  hits=$(printf '%s\n' "$TEMPLATES" | xargs grep -nEH "$CLUSTER_SCOPED" || true)

  if [[ -n "$hits" ]]; then
    fail "cluster-scoped-lookup" \
      "these templates read a cluster-scoped resource, which fails the render outright for an installer whose RBAC stops at their namespace:
$hits
Use a namespaced lookup, or tell the operator the command to run themselves."
  fi
}

# @scenario "The install notes never depend on reading the cluster"
test_notes_make_no_lookup() {
  local hits
  # The anchor check above guarantees at least one NOTES.txt, so xargs always
  # gets a file operand and can never fall through to reading stdin.
  hits=$(printf '%s\n' "$TEMPLATES" | grep 'NOTES\.txt$' | xargs grep -nEH "$ANY_LOOKUP_CALL" || true)

  if [[ -n "$hits" ]]; then
    fail "notes-lookup" \
      "NOTES.txt reads the cluster:
$hits
The notes are advice printed after the work is done, so nothing in them is
worth failing an install over. Print the command for the operator to run."
  fi
}

test_no_cluster_scoped_lookup
test_notes_make_no_lookup

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: no template requires cluster-scoped read access to render"
