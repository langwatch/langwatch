#!/bin/bash
# Shared write_overrides helper (#3860 AC#6).
#
# Writes `langwatch/.env.dev-up` listing ONLY the URLs whose services are
# starting locally for the given mode. compose loads the overlay AFTER
# `langwatch/.env`, so non-overridden URLs keep their .env values — the
# contributor's `.env` is the source of truth.
#
# Sourced by `scripts/dev.sh` (intent-based modes) and `scripts/dev-up.sh`
# (legacy compose-profile names) so the two launchers can't drift on the
# overlay format.
#
# Mode names map onto compose profiles like this:
#   frontend-only     no compose
#   backend-shared    default profile (postgres + redis + clickhouse + app)
#   migration         postgres + clickhouse on host ports
#   workers|scenarios + workers + bullboard + langwatch_nlp (no langevals)
#   nlp               + langwatch_nlp + langevals
#   full | full-local --profile full (everything)
#   debug | test      + bullboard / ai-server (no extra URL overrides)
#
# The langwatch_nlp / langevals URLs follow compose profile membership:
#   langwatch_nlp is in [nlp, scenarios, full]
#   langevals    is in [nlp, full]
# We override each URL only when the corresponding container actually starts
# for the given mode.

write_dev_overrides() {
  local mode="${1-}"
  local out="${2:-langwatch/.env.dev-up}"
  : > "$out"

  # Always-on: dev uses email auth (no Auth0 dependency).
  echo "NEXTAUTH_PROVIDER=email" >> "$out"

  case "$mode" in
    frontend-only)
      # No compose at all — nothing to override.
      return 0
      ;;
    migration)
      # postgres + clickhouse on host ports for `pnpm prisma migrate` from host.
      cat >> "$out" <<'EOF'
DATABASE_URL=postgresql://prisma:prisma@localhost:5432/mydb?schema=mydb
CLICKHOUSE_URL=http://default:langwatch@localhost:8123/langwatch
EOF
      return 0
      ;;
  esac

  # Every other mode runs the default profile (postgres + redis + clickhouse + app).
  cat >> "$out" <<'EOF'
DATABASE_URL=postgresql://prisma:prisma@postgres:5432/mydb?schema=mydb
REDIS_URL=redis://redis:6379
CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123/langwatch
EOF

  # langwatch_nlp service runs under nlp / scenarios / full / full-local / workers.
  case "$mode" in
    nlp|scenarios|full|full-local|workers)
      echo "LANGWATCH_NLP_SERVICE=http://langwatch_nlp:5561" >> "$out"
      ;;
  esac

  # langevals service runs only under nlp / full / full-local.
  case "$mode" in
    nlp|full|full-local)
      echo "LANGEVALS_ENDPOINT=http://langevals:5562" >> "$out"
      ;;
  esac
}
