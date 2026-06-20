#!/usr/bin/env bash
#
# generate-codeowners.sh — regenerate .github/CODEOWNERS from git history,
# with owners derived dynamically from the langwatch GitHub org.
#
# Nothing about *who* can own code is hand-maintained here:
#   - The eligible-owner allowlist is the live org membership
#     (`gh api orgs/langwatch/members`), minus bots.
#   - Commit email -> GitHub login is resolved from GitHub's own attribution
#     (a recent-commit sample via the API), so there is no identity table.
# Only the *structure* (which paths get rules) is curated, in generate().
#
# Per area, owners are the org members who have committed most to that path
# (recent history), capped at two. @0xdeafcafe is additionally guaranteed on
# the Go surface by standing arrangement.
#
# AUTH: langwatch has no public members, so a plain repo-scoped GITHUB_TOKEN
# returns an empty member list. Run with a token that has `read:org` (locally:
# your `gh auth`; in CI: the CODEOWNERS_REFRESH_TOKEN secret). If no members
# come back the script hard-fails rather than writing an empty-ownership file.
#
# Run from anywhere in the repo with full history (CI: fetch-depth: 0). The
# weekly .github/workflows/codeowners-refresh.yml runs this and opens a PR
# when the result differs from what is committed.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

TARGET=".github/CODEOWNERS"
ORG="langwatch"
REPO="langwatch/langwatch"

# Policy owners (bare logins; must be org members — validated below).
DEFAULT_OWNER="rogeriochaves"   # global fallback / used when an area has no member history
GO_COOWNER="0xdeafcafe"         # standing co-owner of the Go surface

SAMPLE_COMMITS=2000             # recent commits sampled to resolve email -> login
SECONDARY_MIN=2                 # a 2nd owner needs at least this many commits ...
SECONDARY_RATIO_PCT=25          # ... and at least this percent of the top owner's

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MEMBER_FILE="$TMP/members"
MAP_FILE="$TMP/email2login"

# --- 1. Eligible owners: current org members, minus bots/automation accounts.
gh api "orgs/$ORG/members" --paginate --jq '.[].login' 2>/dev/null \
  | grep -ivE '\[bot\]$|(^|-)(agent|bot)$' \
  | sort -u > "$MEMBER_FILE" || true

member_count="$(wc -l < "$MEMBER_FILE" | tr -d ' ')"
if [ "$member_count" -eq 0 ]; then
  echo "ERROR: 'gh api orgs/$ORG/members' returned no members — the token almost" >&2
  echo "       certainly lacks read:org (langwatch has no public members)." >&2
  echo "       Refusing to generate a CODEOWNERS with no owners." >&2
  exit 1
fi
echo "Eligible owners ($member_count org members): $(tr '\n' ' ' < "$MEMBER_FILE")" >&2

for required in "$DEFAULT_OWNER" "$GO_COOWNER"; do
  grep -qix "$required" "$MEMBER_FILE" \
    || echo "WARNING: configured policy owner '$required' is not an org member." >&2
done

# --- 2. email -> GitHub login, from a recent-commit sample (GitHub attributes
#        each commit to a user, so we don't keep a hand-written identity map).
pages=$(( (SAMPLE_COMMITS + 99) / 100 ))
for p in $(seq 1 "$pages"); do
  gh api "repos/$REPO/commits?sha=main&per_page=100&page=$p" \
    --jq '.[] | select(.author.login != null) | [.commit.author.email, .author.login] | @tsv' \
    2>/dev/null || true
done | sort -u > "$MAP_FILE"

# owners_for <pathspec...> — top (max 2) org-member owners for the given paths,
# as space-separated bare logins, or empty if none.
owners_for() {
  git log --no-merges --format='%ae' -- "$@" 2>/dev/null | awk \
    -v mapf="$MAP_FILE" -v memf="$MEMBER_FILE" \
    -v smin="$SECONDARY_MIN" -v sratio="$SECONDARY_RATIO_PCT" '
    BEGIN {
      while ((getline x < mapf) > 0) { if (split(x, a, "\t") >= 2) e2l[tolower(a[1])] = a[2] }
      while ((getline m < memf) > 0) { member[tolower(m)] = 1 }
    }
    {
      l = e2l[tolower($0)]
      if (l != "" && (tolower(l) in member)) c[l]++
    }
    END {
      k = 0
      for (x in c) keys[++k] = x
      if (k == 0) exit 0
      for (i = 1; i <= k; i++)
        for (j = i + 1; j <= k; j++)
          if (c[keys[j]] > c[keys[i]] ||
              (c[keys[j]] == c[keys[i]] && keys[j] < keys[i])) {
            t = keys[i]; keys[i] = keys[j]; keys[j] = t
          }
      out = keys[1]
      if (k >= 2) {
        thr = smin
        rt = int(c[keys[1]] * sratio / 100)
        if (rt > thr) thr = rt
        if (c[keys[2]] >= thr) out = out " " keys[2]
      }
      print out
    }'
}

# fmt <bare-login...> — prefix each login with @ for CODEOWNERS.
fmt() {
  local out=""
  for o in "$@"; do out="$out @$o"; done
  echo "${out# }"
}

# emit <codeowners-pattern> <pathspec...>
emit() {
  local pattern="$1"; shift
  local raw; raw="$(owners_for "$@")"
  [ -z "$raw" ] && raw="$DEFAULT_OWNER"
  # shellcheck disable=SC2086
  printf '%-46s %s\n' "$pattern" "$(fmt $raw)"
}

# rule <codeowners-pattern> [pathspec] — derive the pathspec from the pattern
# (strip leading/trailing slash) unless one is given.
rule() {
  local pattern="$1" spec="${2:-}"
  if [ -z "$spec" ]; then spec="${pattern#/}"; spec="${spec%/}"; fi
  emit "$pattern" "$spec"
}

# go_rule <codeowners-pattern> [pathspec] — like rule(), but guarantees the Go
# co-owner is on the rule regardless of commit counts.
go_rule() {
  local pattern="$1" spec="${2:-}"
  if [ -z "$spec" ]; then spec="${pattern#/}"; spec="${spec%/}"; fi
  local raw; raw="$(owners_for "$spec")"
  [ -z "$raw" ] && raw="$DEFAULT_OWNER"
  case " $raw " in *" $GO_COOWNER "*) : ;; *) raw="$raw $GO_COOWNER" ;; esac
  # shellcheck disable=SC2086
  printf '%-46s %s\n' "$pattern" "$(fmt $raw)"
}

generate() {
  cat <<'HEADER'
# CODEOWNERS — GENERATED FILE, DO NOT EDIT BY HAND.
#
# Regenerated weekly by .github/workflows/codeowners-refresh.yml from
# .github/scripts/generate-codeowners.sh. Owners are the top committers per
# area, restricted to current langwatch GitHub org members (the org roster and
# the email->login mapping are both fetched live, so nothing here is a
# hand-maintained list). To change ownership, adjust the generator script — not
# this file.
#
# GitHub applies the LAST matching pattern only — rules go from general (top)
# to specific (bottom). Owners must have write access to the repo.

# ===========================================================================
# Global fallback — overall top contributor across the repo.
# ===========================================================================
HEADER
  emit "*" "."

  cat <<'SECTION'

# ===========================================================================
# Repo-level config, build & dependency manifests
# ===========================================================================
SECTION
  go_rule "/go.mod"
  go_rule "/go.sum"
  rule "/package.json"
  rule "/pnpm-workspace.yaml"
  rule "/pnpm-lock.yaml"

  cat <<'SECTION'

# ===========================================================================
# CI, infra, deployment & dev environment
# ===========================================================================
SECTION
  rule "/.github/"
  rule "/charts/"
  rule "/clickhouse-serverless/"
  rule "/bullboard/"
  rule "/dev/"
  rule "/agentic-e2e-tests/"
  rule "/Makefile"
  rule "/boxd.mk"
  # `:(glob)` keeps `*` from crossing `/`, so these pathspecs match only
  # root-level files — mirroring the root-anchored CODEOWNERS patterns.
  rule "/*.mk" ":(glob)*.mk"
  rule "/compose*.yml" ":(glob)compose*.yml"
  rule "/Dockerfile" ":(glob)Dockerfile"
  rule "/Dockerfile.*" ":(glob)Dockerfile.*"
  rule "/CLAUDE.md"

  cat <<'SECTION'

# ===========================================================================
# Go services & shared Go code
# ===========================================================================
SECTION
  go_rule "/services/nlpgo/"
  go_rule "/services/aigateway/"
  go_rule "/pkg/"
  go_rule "/cmd/"
  go_rule "/sdk-go/"
  go_rule "/Dockerfile.go_service" "Dockerfile.go_service"

  cat <<'SECTION'

# ===========================================================================
# SDKs & integrations
# ===========================================================================
SECTION
  rule "/python-sdk/"
  rule "/typescript-sdk/"
  rule "/mcp-server/"
  rule "/langevals/"

  cat <<'SECTION'

# ===========================================================================
# Specs (BDD .feature files)
# ===========================================================================
SECTION
  rule "/specs/"
  rule "/specs/ai-gateway/"
  rule "/specs/ai-governance/"
  rule "/specs/nlp-go/"
  rule "/specs/model-providers/"
  rule "/specs/event-sourcing/"
  rule "/specs/evaluators/"
  rule "/specs/monitors/"
  rule "/specs/licensing/"
  rule "/specs/billing/"
  rule "/specs/data-retention/"
  rule "/specs/members/"
  rule "/specs/api-keys/"
  rule "/specs/prompts/"

  cat <<'SECTION'

# ===========================================================================
# Docs
# ===========================================================================
SECTION
  rule "/docs/"
  rule "/docs/adr/"
  rule "/docs/api-reference/"
  rule "/docs/integration/"
  rule "/docs/self-hosting/"

  cat <<'SECTION'

# ===========================================================================
# Skills
# ===========================================================================
SECTION
  rule "/skills/"

  cat <<'SECTION'

# ===========================================================================
# Main app (langwatch/) — schema, EE, optimization studio, top-level dirs
# ===========================================================================
SECTION
  rule "/langwatch/prisma/"
  rule "/langwatch/ee/"
  rule "/langwatch/elastic/"
  rule "/langwatch/e2e/"
  rule "/langwatch/scripts/"
  rule "/langwatch/src/optimization_studio/"
  rule "/langwatch/src/hooks/"
  rule "/langwatch/src/utils/"
  rule "/langwatch/src/tasks/"
  rule "/langwatch/src/features/"
  rule "/langwatch/src/prompts/"
  emit "/langwatch/src/experiments-v3/" "langwatch/src/experiments-v3" "langwatch/src/evaluations-v3"
  rule "/langwatch/src/app/api/"

  cat <<'SECTION'

# ---------------------------------------------------------------------------
# Main app — pages
# ---------------------------------------------------------------------------
SECTION
  rule "/langwatch/src/pages/api/"
  rule "/langwatch/src/pages/settings/"
  rule "/langwatch/src/pages/onboarding/"
  rule "/langwatch/src/pages/auth/"

  cat <<'SECTION'

# ===========================================================================
# Main app — server domains
# ===========================================================================
SECTION
  rule "/langwatch/src/server/analytics/"
  rule "/langwatch/src/server/annotations/"
  rule "/langwatch/src/server/api/"
  rule "/langwatch/src/server/app-layer/"
  rule "/langwatch/src/server/background/"
  rule "/langwatch/src/server/clickhouse/"
  rule "/langwatch/src/server/datasets/"
  rule "/langwatch/src/server/evaluations/"
  rule "/langwatch/src/server/evaluators/"
  rule "/langwatch/src/server/event-sourcing/"
  rule "/langwatch/src/server/experiments/"
  emit "/langwatch/src/server/experiments-v3/" "langwatch/src/server/experiments-v3" "langwatch/src/server/evaluations-v3"
  rule "/langwatch/src/server/featureFlag/"
  rule "/langwatch/src/server/filters/"
  go_rule "/langwatch/src/server/gateway/"
  rule "/langwatch/src/server/modelProviders/"
  rule "/langwatch/src/server/prompt-config/"
  rule "/langwatch/src/server/repositories/"
  rule "/langwatch/src/server/routes/"
  rule "/langwatch/src/server/scenarios/"
  rule "/langwatch/src/server/simulations/"
  rule "/langwatch/src/server/suites/"
  rule "/langwatch/src/server/topicClustering/"
  rule "/langwatch/src/server/tracer/"
  rule "/langwatch/src/server/traces/"
  rule "/langwatch/src/server/triggers/"
  rule "/langwatch/src/server/workflows/"

  cat <<'SECTION'

# Auth, permissions & multitenancy
SECTION
  rule "/langwatch/src/server/agents/"
  rule "/langwatch/src/server/rbac/"
  rule "/langwatch/src/server/role/"
  rule "/langwatch/src/server/role-bindings/"
  rule "/langwatch/src/server/scim/"
  rule "/langwatch/src/server/teams/"
  rule "/langwatch/src/server/invites/"
  rule "/langwatch/src/server/api-key/"

  cat <<'SECTION'

# Billing, licensing & data retention
SECTION
  rule "/langwatch/src/server/license-enforcement/"
  rule "/langwatch/src/server/data-retention/"
  rule "/langwatch/src/server/subscriptionHandler.ts" "langwatch/src/server/subscriptionHandler.ts"

  cat <<'SECTION'

# ===========================================================================
# Main app — UI components
# ===========================================================================
SECTION
  rule "/langwatch/src/components/agents/"
  rule "/langwatch/src/components/analytics/"
  rule "/langwatch/src/components/annotations/"
  rule "/langwatch/src/components/checks/"
  rule "/langwatch/src/components/datasets/"
  rule "/langwatch/src/components/drawers/"
  rule "/langwatch/src/components/evaluations/"
  rule "/langwatch/src/components/evaluators/"
  rule "/langwatch/src/components/experiments/"
  rule "/langwatch/src/components/filters/"
  rule "/langwatch/src/components/forms/"
  rule "/langwatch/src/components/inputs/"
  rule "/langwatch/src/components/license/"
  rule "/langwatch/src/components/llmPromptConfigs/"
  rule "/langwatch/src/components/messages/"
  rule "/langwatch/src/components/plans/"
  rule "/langwatch/src/components/projects/"
  rule "/langwatch/src/components/scenarios/"
  rule "/langwatch/src/components/settings/"
  rule "/langwatch/src/components/sidebar/"
  rule "/langwatch/src/components/simulations/"
  rule "/langwatch/src/components/subscription/"
  rule "/langwatch/src/components/suites/"
  rule "/langwatch/src/components/traces/"
  rule "/langwatch/src/components/ui/"
  rule "/langwatch/src/components/workflows/"
}

generate > "$TARGET"
echo "Wrote $TARGET" >&2
