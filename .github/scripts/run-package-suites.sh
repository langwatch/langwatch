#!/usr/bin/env bash
# Run every workspace package's own test suite.
#
# WHY THIS EXISTS
#
# The package suites under packages/ are unreachable from the applications' vitest
# root, so a suite there does not merely go unsharded — it runs nowhere at all.
# For a long time the answer was a hand-written step per package in
# langwatch-app-ci.yml. That list reached seventeen packages while the workspace
# reached a hundred and sixty, because a hand-written list makes a NEW package
# invisible by DEFAULT rather than by decision. The core-application feature
# extraction (dev/docs/plans/core-application-feature-extraction-plan.md, F-CI-02)
# turns that from a slow leak into an active one: every wave moves behaviour out
# of the monolith, which CI ran, into packages/features/*, which it did not.
#
# So this script DISCOVERS the packages instead of being told about them. It
# asks pnpm for the workspace membership, which is the same list the installer
# resolves, so a package added to pnpm-workspace.yaml is in CI the moment it has
# a test script — no edit here, and no way to forget.
#
# THE TWO REGISTERS
#
# Discovery finds suites that must not gate this job, and each kind gets an
# enumerated file rather than a wildcard, so adding a package to either is one
# line in a diff with a reason attached:
#
#   .github/package-suites.excluded
#       This job does not run it at all. Two reasons qualify, and the line has
#       to say which: its suite already runs in a workflow of its own, or it
#       cannot run on this runner at any exit code — a Playwright harness that
#       needs the app up, a scenario suite that needs a provider API key. A
#       suite in the second group would spend seven minutes failing on purpose,
#       which is not a signal, it is a bill.
#
#   .github/package-suites.allowed-failures
#       Its suite is RED today. The alternative to naming it here is landing
#       this job red, and a job that lands red and stays red teaches everyone to
#       ignore it — strictly worse than the blind spot it replaces.
#
# Both registers may only shrink. Nothing mechanical stops a line being added,
# because nothing mechanical can tell a fix from a capitulation; what the script
# enforces is that every line stays HONEST — an entry naming a package the
# workspace no longer has fails the job, and an allowed failure that has started
# passing is announced so the line can go.
#
# A package that needs a datastore is NOT a case for the register on its own.
# Its suite is expected to self-skip cleanly when the connection string is
# absent (`describe.skipIf(!process.env.DATABASE_URL)`, the way
# packages/features/share/server does it), so it runs its unit coverage here and
# its integration coverage wherever a database exists. Only a suite that cannot
# do that belongs in the register, with that as its stated reason.
#
# Usage: bash .github/scripts/run-package-suites.sh
# Environment: none required. Anything the suites themselves read (DATABASE_URL,
# REDIS_URL, CREDENTIALS_SECRET) is supplied by the calling job.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXCLUDED_FILE="$ROOT/.github/package-suites.excluded"
ALLOWED_FILE="$ROOT/.github/package-suites.allowed-failures"

cd "$ROOT" || exit 1

# --- registers ---------------------------------------------------------------

# Reads one register into two parallel arrays of names and reasons. A line is
# `<package name><whitespace># <reason>`; blanks and whole-line comments are
# skipped. The reason is MANDATORY: an unexplained entry is how a register stops
# being reviewable, so a bare name is a hard error rather than a default reason.
REGISTER_NAMES=()
REGISTER_REASONS=()
read_register() {
  local file="$1" label="$2" line name reason lineno=0
  REGISTER_NAMES=()
  REGISTER_REASONS=()
  [ -f "$file" ] || {
    echo "::error::$label register is missing: $file"
    return 1
  }
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    line="${line%"${line##*[![:space:]]}"}"
    line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    case "$line" in
      *"#"*)
        name="${line%%#*}"
        reason="${line#*#}"
        ;;
      *)
        echo "::error file=$file,line=$lineno::'$line' has no reason. Write '<package>  # why it is here'."
        return 1
        ;;
    esac
    name="${name%"${name##*[![:space:]]}"}"
    reason="${reason#"${reason%%[![:space:]]*}"}"
    if [ -z "$name" ] || [ -z "$reason" ]; then
      echo "::error file=$file,line=$lineno::'$line' is not '<package>  # why it is here'."
      return 1
    fi
    REGISTER_NAMES+=("$name")
    REGISTER_REASONS+=("$reason")
  done < "$file"
  return 0
}

in_list() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

reason_for() {
  local needle="$1" i=0
  for i in "${!REG_ALL_NAMES[@]}"; do
    [ "${REG_ALL_NAMES[$i]}" = "$needle" ] && {
      printf '%s' "${REG_ALL_REASONS[$i]}"
      return 0
    }
  done
  printf '%s' "no reason recorded"
}

read_register "$EXCLUDED_FILE" "excluded" || exit 1
EXCLUDED_NAMES=("${REGISTER_NAMES[@]+"${REGISTER_NAMES[@]}"}")
EXCLUDED_REASONS=("${REGISTER_REASONS[@]+"${REGISTER_REASONS[@]}"}")

read_register "$ALLOWED_FILE" "allowed-failures" || exit 1
ALLOWED_NAMES=("${REGISTER_NAMES[@]+"${REGISTER_NAMES[@]}"}")
ALLOWED_REASONS=("${REGISTER_REASONS[@]+"${REGISTER_REASONS[@]}"}")

REG_ALL_NAMES=("${EXCLUDED_NAMES[@]+"${EXCLUDED_NAMES[@]}"}" "${ALLOWED_NAMES[@]+"${ALLOWED_NAMES[@]}"}")
REG_ALL_REASONS=("${EXCLUDED_REASONS[@]+"${EXCLUDED_REASONS[@]}"}" "${ALLOWED_REASONS[@]+"${ALLOWED_REASONS[@]}"}")

# --- discovery ---------------------------------------------------------------

# `pnpm list --recursive --depth -1` is the workspace membership itself, not a
# second copy of pnpm-workspace.yaml's globs that could drift from it. The node
# step turns it into `<name>\t<relative dir>\t<script>` rows, choosing the
# script the same way for every package: `test:unit` where a package draws the
# distinction, `test` where that is the only suite it has. Packages with
# neither are silently absent, which is correct — there is nothing to run.
LIST_JSON="$(pnpm list --recursive --depth -1 --json 2>/dev/null)"
if [ -z "$LIST_JSON" ]; then
  echo "::error::pnpm list returned nothing. The workspace could not be enumerated, so this job cannot know what it is meant to run."
  exit 1
fi

DISCOVERED="$(printf '%s' "$LIST_JSON" | ROOT="$ROOT" node -e '
const fs = require("fs");
const path = require("path");
let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  const root = process.env.ROOT;
  const rows = [];
  for (const project of JSON.parse(raw)) {
    if (!project.path || path.resolve(project.path) === path.resolve(root)) continue;
    const manifest = path.join(project.path, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const scripts = JSON.parse(fs.readFileSync(manifest, "utf8")).scripts || {};
    const script = scripts["test:unit"] ? "test:unit" : scripts.test ? "test" : null;
    if (!script) continue;
    rows.push([project.name, path.relative(root, project.path), script].join("\t"));
  }
  rows.sort();
  process.stdout.write(rows.join("\n"));
});
')"

if [ -z "$DISCOVERED" ]; then
  echo "::error::No workspace package declares a test or test:unit script. That is not a state this repository has ever been in, so treat it as a broken discovery step rather than as good news."
  exit 1
fi

ALL_NAMES=()
while IFS=$'\t' read -r name _dir _script; do
  [ -n "$name" ] && ALL_NAMES+=("$name")
done <<< "$DISCOVERED"

# A register entry naming a package the workspace does not have is dead weight
# that reads as coverage. Renames are the common way it happens: the hand-written
# block this job replaces still named `@langwatch/authz`, months after the
# package became `@langwatch/authz-contract` under packages/features/.
STALE=0
for i in "${!REG_ALL_NAMES[@]}"; do
  entry="${REG_ALL_NAMES[$i]}"
  if ! in_list "$entry" "${ALL_NAMES[@]}"; then
    echo "::error::'$entry' is registered but no workspace package by that name declares a test script. Delete the line, or fix the name if the package was renamed."
    STALE=1
  fi
done
for entry in "${ALLOWED_NAMES[@]+"${ALLOWED_NAMES[@]}"}"; do
  if in_list "$entry" "${EXCLUDED_NAMES[@]+"${EXCLUDED_NAMES[@]}"}"; then
    echo "::error::'$entry' is in both registers. A suite this job never runs cannot also be a failure it tolerates."
    STALE=1
  fi
done
[ "$STALE" -eq 0 ] || exit 1

# --- run ---------------------------------------------------------------------

# Serial on purpose. Each suite is its own vitest process with its own worker
# pool, so running several at once oversubscribes a 4-core runner and turns real
# results into "[vitest-pool]: Worker forks emitted error" — a failure mode that
# looks like a broken test and is not one.
PASSED=(); FAILED=(); TOLERATED=(); UNEXPECTED_PASS=(); SKIPPED=()

while IFS=$'\t' read -r name dir script; do
  [ -n "$name" ] || continue

  if in_list "$name" "${EXCLUDED_NAMES[@]+"${EXCLUDED_NAMES[@]}"}"; then
    # Named out loud, never silently. An exclusion nobody can see in the log is
    # indistinguishable from a package discovery never found.
    echo "not run: $name — $(reason_for "$name")"
    SKIPPED+=("$name")
    continue
  fi

  tolerated=no
  in_list "$name" "${ALLOWED_NAMES[@]+"${ALLOWED_NAMES[@]}"}" && tolerated=yes

  echo "::group::$name ($dir) — pnpm run $script"
  pnpm --filter "$name" run "$script"
  status=$?
  echo "::endgroup::"

  if [ "$status" -eq 0 ]; then
    if [ "$tolerated" = yes ]; then
      UNEXPECTED_PASS+=("$name")
      echo "::warning::$name is in $ALLOWED_FILE and passed. Delete its line — the register only earns its keep while every entry is still true."
    else
      PASSED+=("$name")
    fi
  elif [ "$tolerated" = yes ]; then
    TOLERATED+=("$name")
    echo "::warning::$name failed, and is a registered allowed failure: $(reason_for "$name")"
  else
    FAILED+=("$name")
    echo "::error::$name failed (pnpm run $script, exit $status). Fix it, or add it to $ALLOWED_FILE with a reason."
  fi
done <<< "$DISCOVERED"

# --- summary -----------------------------------------------------------------

emit() {
  echo "$1"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"
  return 0
}

echo ""
emit "### Package suites"
emit ""
emit "| outcome | count |"
emit "| --- | --- |"
emit "| passed | ${#PASSED[@]} |"
emit "| failed | ${#FAILED[@]} |"
emit "| allowed failures (registered) | ${#TOLERATED[@]} |"
emit "| registered failures that now pass | ${#UNEXPECTED_PASS[@]} |"
emit "| excluded (registered, not run) | ${#SKIPPED[@]} |"

if [ "${#FAILED[@]}" -gt 0 ]; then
  emit ""
  emit "Failed: ${FAILED[*]}"
  echo ""
  echo "::error::${#FAILED[@]} package suite(s) failed and are not registered."
  exit 1
fi

if [ "${#UNEXPECTED_PASS[@]}" -gt 0 ]; then
  emit ""
  emit "Now passing, remove from $ALLOWED_FILE: ${UNEXPECTED_PASS[*]}"
fi

echo ""
echo "All ${#PASSED[@]} gating package suites passed."
exit 0
