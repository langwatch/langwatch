#!/bin/sh
# Reap stranded GroupQueue group keys (one-shot prod ops tool).
#
# A "stranded" group holds jobs in {prefix}group:<gid>:jobs but is absent from
# the ready / active / blocked state sets, so the dispatcher never picks it up
# and never reclaims it. These accumulate with no TTL and were the bulk of the
# 2026-05-27 Redis memory bloat (~82K keys, ~4.79GB), left behind when the
# ready set was cleared during incident mitigation without draining the groups.
#
# DRY-RUN BY DEFAULT: discovers stranded groups, writes them to OUT, prints a
# summary, and stops. Re-run with APPLY=1 to delete the discovered set.
# Only reaps groups whose newest job score is older than MIN_AGE_HOURS, so a
# briefly-stranded live group (re-staged within the dispatch window) is never
# touched. A live group is touched at least every ~10 min (maxBackoffMs), so a
# multi-hour age floor cannot hit one.
#
# Usage (inside a redis:7-alpine pod, same pattern as the drain pods):
#   H=<host> REDISCLI_AUTH=<pw> MIN_AGE_HOURS=6 sh reap-stranded-group-keys.sh        # discover
#   H=<host> REDISCLI_AUTH=<pw> APPLY=1          sh reap-stranded-group-keys.sh        # delete

set -eu

# A literal "}" cannot live inside a ${VAR:-default} expansion in POSIX sh (the
# first "}" closes the expansion), so set the default in two steps.
PREFIX="${PREFIX:-}"
[ -n "$PREFIX" ] || PREFIX='{event-sourcing/jobs}:gq:'
APPLY="${APPLY:-0}"
MIN_AGE_HOURS="${MIN_AGE_HOURS:-6}"
OUT="${OUT:-/tmp/stranded-groups.tsv}"

R="redis-cli -h ${H:?set H to the redis host} -p ${PORT:-6379} --tls --no-auth-warning"

ready_key="${PREFIX}ready"
blocked_key="${PREFIX}blocked"
total_pending_key="${PREFIX}stats:total-pending"

now_ms=$(( $($R TIME | head -1) * 1000 ))
cutoff_ms=$(( now_ms - MIN_AGE_HOURS * 3600 * 1000 ))

echo "mode=$([ "$APPLY" = "1" ] && echo APPLY || echo DISCOVER) prefix=${PREFIX} min_age_hours=${MIN_AGE_HOURS} cutoff_ms=${cutoff_ms} out=${OUT}"

# ── Discover ──────────────────────────────────────────────────────────────
# Writes one "<jobs_key>\t<data_key>\t<job_count>" row per stranded group.
: > "$OUT"
$R --scan --pattern "${PREFIX}group:*:jobs" | while IFS= read -r jobs_key; do
  # Strip the actual ${PREFIX}group: prefix and :jobs suffix. Prefix-agnostic:
  # never hard-code :gq: here, or a PREFIX override would mis-extract gid and
  # the ready/active/blocked guards below would check the wrong group.
  gid="${jobs_key#"${PREFIX}"group:}"
  gid="${gid%:jobs}"
  active_key="${PREFIX}group:${gid}:active"
  data_key="${PREFIX}group:${gid}:data"

  # Skip groups still wired into the dispatch graph.
  [ -n "$($R ZSCORE "$ready_key" "$gid")" ] && continue
  [ "$($R EXISTS "$active_key")" = "1" ] && continue
  [ "$($R SISMEMBER "$blocked_key" "$gid")" = "1" ] && continue

  # Newest job score must be older than the cutoff (stale, not delayed-live).
  newest=$($R ZRANGE "$jobs_key" -1 -1 WITHSCORES | tail -1)
  case "$newest" in ''|*[!0-9]*) continue ;; esac
  [ "$newest" -ge "$cutoff_ms" ] && continue

  printf '%s\t%s\t%s\n' "$jobs_key" "$data_key" "$($R ZCARD "$jobs_key")" >> "$OUT"
done

groups=$(wc -l < "$OUT" | tr -d ' ')
jobs=$(awk -F'\t' '{s+=$3} END {print s+0}' "$OUT")
echo "stranded_groups=${groups} stranded_jobs=${jobs}"

if [ "$APPLY" != "1" ]; then
  echo "DISCOVER only. Review ${OUT}, then re-run with APPLY=1 to delete."
  exit 0
fi

# ── Apply ─────────────────────────────────────────────────────────────────
deleted=0
failed=0
while IFS="$(printf '\t')" read -r jobs_key data_key _; do
  # Tolerate a transient redis-cli blip: one failed DEL must not abort the whole
  # sweep under set -eu. The reaper is safe to re-run, but finishing in a single
  # pass keeps the recompute below accurate.
  if $R DEL "$jobs_key" "$data_key" >/dev/null; then
    deleted=$((deleted + 1))
  else
    failed=$((failed + 1))
    echo "  WARN: DEL failed for ${jobs_key} (transient?), continuing"
  fi
  [ $(((deleted + failed) % 1000)) -eq 0 ] && echo "  ... processed $((deleted + failed))/${groups}"
done < "$OUT"

# Recompute stats:total-pending from the surviving groups rather than DECRing
# per delete: the counter had already drifted negative from the incident, so a
# per-group DECRBY would only compound the error. Sum the remaining job zsets.
echo "recomputing ${total_pending_key} from surviving groups ..."
# Sum the surviving job zsets straight through awk. No reused temp file: a fixed
# /tmp path would feed a stale count into a later run whose scan returns nothing
# (the while body runs in a pipe subshell, so it cannot export the sum directly).
remaining=$($R --scan --pattern "${PREFIX}group:*:jobs" | while IFS= read -r jk; do
  $R ZCARD "$jk"
done | awk '{s+=$1} END {print s+0}')
$R SET "$total_pending_key" "$remaining" >/dev/null
echo "DONE deleted_groups=${deleted} failed_deletes=${failed} total_pending_now=$($R GET "$total_pending_key")"
