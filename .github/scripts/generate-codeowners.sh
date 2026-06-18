#!/usr/bin/env bash
#
# generate-codeowners.sh — regenerate .github/CODEOWNERS from git history.
#
# Ownership is derived per area from `git log` authorship: the owners of an
# area are its top historical commit authors. Merge commits, bots, and
# departed contributors are excluded; unknown one-off external authors are
# ignored. The list of areas (the structure of the file) is curated below;
# only the *owners* of each area are recomputed, so the file stays stable
# while reviewer assignments track who is actually working where.
#
# Run from anywhere inside the repo. Requires full git history
# (`git clone` depth 0 / `fetch-depth: 0` in CI). The weekly
# .github/workflows/codeowners-refresh.yml workflow runs this and opens a
# PR when the result differs from what is committed.
#
# To change ownership policy, edit:
#   - the identity map / exclusion list in owners_for() below, or
#   - the curated area list in generate().

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

TARGET=".github/CODEOWNERS"

# Overall top contributor — used for the `*` global fallback and whenever an
# area has no attributable history left after exclusions.
DEFAULT_OWNER="@rogeriochaves"

# Secondary owner is listed only when their commit count clears both floors.
SECONDARY_MIN=2          # absolute minimum commits
SECONDARY_RATIO_PCT=25   # and at least this percent of the primary's commits

# owners_for <pathspec...> — print the top (max 2) owners for the given paths,
# space-separated, or nothing if no attributable history.
owners_for() {
  git log --no-merges --format='%ae' -- "$@" 2>/dev/null | awk \
    -v smin="$SECONDARY_MIN" -v sratio="$SECONDARY_RATIO_PCT" '
    {
      e = tolower($0)

      # --- bots / automation: never owners ---
      if (e ~ /\[bot\]|dependabot|github-actions|coderabbit|copilot|snyk-bot|langwatch-agent|langwatchagent|krusty@langwatch|orchardist/) next
      if (e ~ /ip-[0-9].*compute\.internal/) next

      # --- departed / excluded contributors ---
      if (e ~ /richhuth/) next            # left the company
      if (e ~ /budnyk|eugenumber/) next   # excluded by request

      # --- identity map: email -> GitHub handle ---
      if      (e ~ /rogeriochaves|rogerio@langwatch/) h = "@rogeriochaves"
      else if (e ~ /alex\.forbes\.red|0xdeafcafe/)    h = "@0xdeafcafe"
      else if (e ~ /drewdrewthis|andrew@langwatch/)   h = "@drewdrewthis"
      else if (e ~ /sergioestebance|sergio\.esteban/) h = "@sergioestebance"
      else if (e ~ /aryansharma|aryan@langwatch/)     h = "@Aryansharma28"
      else if (e ~ /jpwakugawa|wakugawa/)             h = "@jpwakugawa"
      else next   # unknown external one-off contributor — ignore

      c[h]++
    }
    END {
      n = 0
      for (k in c) keys[++n] = k
      if (n == 0) exit 0

      # sort by commit count desc, then handle asc (deterministic ties)
      for (i = 1; i <= n; i++)
        for (j = i + 1; j <= n; j++)
          if (c[keys[j]] > c[keys[i]] ||
              (c[keys[j]] == c[keys[i]] && keys[j] < keys[i])) {
            t = keys[i]; keys[i] = keys[j]; keys[j] = t
          }

      out = keys[1]
      if (n >= 2) {
        thr = smin
        rt = int(c[keys[1]] * sratio / 100)
        if (rt > thr) thr = rt
        if (c[keys[2]] >= thr) out = out " " keys[2]
      }
      print out
    }'
}

# emit <codeowners-pattern> <pathspec...> — print one aligned CODEOWNERS rule.
emit() {
  local pattern="$1"; shift
  local owners
  owners="$(owners_for "$@")"
  [ -z "$owners" ] && owners="$DEFAULT_OWNER"
  printf '%-46s %s\n' "$pattern" "$owners"
}

# rule <codeowners-pattern> [pathspec] — emit a rule, deriving the git
# pathspec from the pattern (strip leading/trailing slash) unless one is given.
rule() {
  local pattern="$1" spec="${2:-}"
  if [ -z "$spec" ]; then
    spec="${pattern#/}"; spec="${spec%/}"
  fi
  emit "$pattern" "$spec"
}

# Always-on co-owner for Go code, regardless of commit counts. @0xdeafcafe
# owns the Go surface (services, shared packages, SDK, the gateway) by
# standing arrangement, so guarantee them on those areas even when history
# alone wouldn't rank them in the top two.
GO_COOWNER="@0xdeafcafe"

# go_rule <codeowners-pattern> [pathspec] — like rule(), but guarantees
# GO_COOWNER is among the owners.
go_rule() {
  local pattern="$1" spec="${2:-}"
  if [ -z "$spec" ]; then
    spec="${pattern#/}"; spec="${spec%/}"
  fi
  local owners
  owners="$(owners_for "$spec")"
  [ -z "$owners" ] && owners="$DEFAULT_OWNER"
  case " $owners " in
    *" $GO_COOWNER "*) : ;;
    *) owners="$owners $GO_COOWNER" ;;
  esac
  printf '%-46s %s\n' "$pattern" "$owners"
}

# warn_unmapped_contributors — the identity map in owners_for() drops any
# author it doesn't recognise. That's correct for one-off external authors,
# but it would also silently exclude a new *internal* contributor who simply
# isn't in the map yet. Run once over all history and warn (to stderr, never
# failing the run) about prolific authors that fall through the map, so the
# map can be kept current. Keep the bot/exclude/map patterns below in sync
# with owners_for().
PROLIFIC_UNMAPPED_MIN=30
warn_unmapped_contributors() {
  git log --all --no-merges --format='%ae' 2>/dev/null | awk -v min="$PROLIFIC_UNMAPPED_MIN" '
    {
      e = tolower($0)
      if (e ~ /\[bot\]|dependabot|github-actions|coderabbit|copilot|snyk-bot|langwatch-agent|langwatchagent|krusty@langwatch|orchardist/) next
      if (e ~ /ip-[0-9].*compute\.internal/) next
      if (e ~ /richhuth/) next            # intentionally excluded
      if (e ~ /budnyk|eugenumber/) next   # intentionally excluded
      if (e ~ /rogeriochaves|rogerio@langwatch|alex\.forbes\.red|0xdeafcafe|drewdrewthis|andrew@langwatch|sergioestebance|sergio\.esteban|aryansharma|aryan@langwatch|jpwakugawa|wakugawa/) next
      u[e]++
    }
    END {
      for (e in u)
        if (u[e] >= min)
          printf "WARNING: unmapped contributor %s (%d commits) is not in the identity map; add them to generate-codeowners.sh if they should be eligible for ownership.\n", e, u[e] > "/dev/stderr"
    }'
}

generate() {
  cat <<'HEADER'
# CODEOWNERS — GENERATED FILE, DO NOT EDIT BY HAND.
#
# Regenerated weekly by .github/workflows/codeowners-refresh.yml from
# .github/scripts/generate-codeowners.sh. Owners are the top historical
# `git log` contributors per area (merges, bots, and departed contributors
# excluded). To change ownership, edit the generator script — not this file.
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

warn_unmapped_contributors
generate > "$TARGET"
echo "Wrote $TARGET"
