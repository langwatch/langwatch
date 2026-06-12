#!/bin/sh
# Reclaim orphaned GroupQueue offload blobs (one-shot prod ops tool).
#
# ADR-026 offloads payloads >32KiB to standalone {prefix}blob:<id> keys. Before
# PR #4758 a dedup squash (recordSpan/reactor re-fold) overwrote a staged value
# in place without reclaiming the blob the displaced value pointed at, so the
# blob leaked until its 7-day TTL. On 2026-06-11 (#4757) this reached ~280K
# orphan blobs / ~7.4GB (~91% of the keyspace). #4758 stops NEW orphans; this
# tool reclaims the EXISTING pool instead of waiting out the 7-day TTL.
#
# DRY-RUN BY DEFAULT: builds the referenced set, discovers orphans, writes them
# to OUT, prints a summary, and stops. Re-run with APPLY=1 to UNLINK them.
#
# A blob is reclaimed only when it is BOTH:
#   (a) UNREFERENCED — no live {prefix}group:*:data envelope carries its id in
#       the "r" field. Protects every STAGED job (normal, paused, retry-backoff —
#       all re-staged into the data hash), so their blobs are kept. The reference
#       set is built FAIL-CLOSED: any SCAN/HVALS error aborts before any delete,
#       because a partial set would misclassify live blobs as orphans.
#   (b) AGED > MIN_AGE_HOURS — derived from remaining TTL (age = BLOB_TTL - ttl).
#       This skips RECENTLY-CREATED blobs, narrowing the window in which a just-
#       staged value's blob could be touched.
#
# SAFETY / in-flight race: (b) keys on blob CREATION time, not dispatch time, so
# it does NOT protect an OLD staged blob dispatched DURING the sweep — its value
# leaves the data hash at dispatch (looks unreferenced) while a worker is about
# to read it. The real backstop is recoverability: a missing blob makes the
# worker's decode throw, the slot is completed, and the event replays from the
# canonical ClickHouse data. In practice this tool's targets are dedup-SQUASHED
# blobs whose staged value was overwritten in place — they have no jobs-zset or
# dedup entry, so they are NON-DISPATCHABLE and the race cannot reach them; the
# only exposed blobs are live delayed/retry/just-unpaused jobs dispatched mid-
# sweep. For ZERO replays, quiesce first: pause the queues and wait for
# {prefix}group:*:active to drain to 0. APPLY refuses to run while any group is
# active unless FORCE=1 (accept the recoverable-replay risk).
#
# Usage (run co-located with redis, e.g. a redis:7-alpine pod like the drain pods):
#   H=<host> REDISCLI_AUTH=<pw> sh reclaim-orphaned-blobs.sh                    # discover
#   H=<host> REDISCLI_AUTH=<pw> APPLY=1 sh reclaim-orphaned-blobs.sh            # reclaim (quiesced)
#   H=<host> REDISCLI_AUTH=<pw> APPLY=1 FORCE=1 sh reclaim-orphaned-blobs.sh    # reclaim on a live system
#   H=127.0.0.1 PORT=6390 TLS= sh reclaim-orphaned-blobs.sh                     # local (no TLS)

set -eu

# A literal "}" cannot live inside a ${VAR:-default} expansion in POSIX sh, so
# set the default in two steps (mirrors reap-stranded-group-keys.sh).
PREFIX="${PREFIX:-}"
[ -n "$PREFIX" ] || PREFIX='{event-sourcing/jobs}:gq:'
APPLY="${APPLY:-0}"
MIN_AGE_HOURS="${MIN_AGE_HOURS:-2}"
# Must match RedisJobBlobStore BLOB_TTL_SECONDS (7 days). age = this - ttl.
BLOB_TTL_SECONDS="${BLOB_TTL_SECONDS:-604800}"
BATCH="${BATCH:-500}"          # keys per UNLINK call (command efficiency)
# Progressive reclaim: free FREE_CHUNK orphans, report memory, pause SLEEP, repeat
# — so memory drains in visible steps instead of one large sweep. UNLINK frees
# asynchronously, so the per-chunk "freed" figure lags slightly and catches up.
FREE_CHUNK="${FREE_CHUNK:-5000}"
SLEEP="${SLEEP:-2}"
LIMIT="${LIMIT:-}"             # optional cap on orphans reclaimed this run (default: all)
OUT="${OUT:-/tmp/orphan-blobs.txt}"
REF="${REF:-/tmp/referenced-blobs.txt}"
TLS="${TLS-1}"          # default on (prod); set TLS= to disable for a local redis
INSECURE="${INSECURE:-}" # set INSECURE=1 to skip TLS cert verification (e.g. reaching
                         # the public ElastiCache endpoint from outside the VPC)

R="redis-cli -h ${H:?set H to the redis host} -p ${PORT:-6379} ${TLS:+--tls} ${INSECURE:+--insecure} --no-auth-warning"

cutoff_ttl=$(( BLOB_TTL_SECONDS - MIN_AGE_HOURS * 3600 ))

echo "mode=$([ "$APPLY" = 1 ] && echo APPLY || echo DISCOVER) prefix=${PREFIX} min_age_hours=${MIN_AGE_HOURS} cutoff_ttl=${cutoff_ttl} batch=${BATCH}"

hashes_tmp=$(mktemp); hvals_tmp=$(mktemp); blobs_tmp=$(mktemp)
ttls_tmp=$(mktemp); sum_tmp=$(mktemp); slice_tmp=$(mktemp); unlink_tmp=$(mktemp)
trap 'rm -f "$hashes_tmp" "$hvals_tmp" "$blobs_tmp" "$ttls_tmp" "$sum_tmp" "$slice_tmp" "$unlink_tmp"' EXIT

# ── 1. Referenced blob ids (FAIL CLOSED) ────────────────────────────────────
# A partial reference set would misclassify live blobs as orphans, so any
# SCAN/HVALS failure aborts before anything is deleted. Collected via files (not
# a pipe) so a mid-stream failure exits the whole script, not just a subshell.
if ! $R --scan --pattern "${PREFIX}group:*:data" --count "${SCAN_COUNT:-1000}" > "$hashes_tmp"; then
  echo "FATAL: SCAN of data hashes failed — aborting (fail closed)" >&2; exit 1
fi
: > "$hvals_tmp"
while IFS= read -r dk; do
  if ! $R HVALS "$dk" >> "$hvals_tmp"; then
    echo "FATAL: HVALS failed for ${dk} — reference set incomplete, aborting (fail closed)" >&2; exit 1
  fi
done < "$hashes_tmp"
# Base64 inline bodies cannot forge a "r":"<uuid>" match (no quotes/colons in
# base64), so this never over-counts.
grep -oE '"r":"[0-9a-f-]{36}"' "$hvals_tmp" | sed 's/.*"r":"//; s/"$//' | sort -u > "$REF"
ref_count=$(wc -l < "$REF" | tr -d ' ')

# ── 2. Discover orphans (unreferenced AND aged) ─────────────────────────────
if ! $R --scan --pattern "${PREFIX}blob:*" --count "${SCAN_COUNT:-1000}" > "$blobs_tmp"; then
  echo "FATAL: SCAN of blob keys failed — aborting" >&2; exit 1
fi
total=$(wc -l < "$blobs_tmp" | tr -d ' ')
# Fetch every blob's TTL in chunks via EVAL — per-key TTL round-trips would be
# 100K+ (≈hours over a WAN). Keys go in ARGV with numkeys=0: blob keys share the
# queue hash tag so they live in one slot, and this is a single-shard replication
# group, so there is no cross-slot concern. xargs preserves input order and EVAL
# returns ARGV order, so ttls_tmp stays line-aligned with blobs_tmp for paste.
: > "$ttls_tmp"
if [ "$total" -gt 0 ]; then
  TTL_LUA='local r={} for i=1,#ARGV do r[i]=redis.call("ttl",ARGV[i]) end return r'
  if ! xargs -n "${CHUNK:-2000}" $R EVAL "$TTL_LUA" 0 < "$blobs_tmp" > "$ttls_tmp"; then
    echo "FATAL: TTL fetch failed — aborting" >&2; exit 1
  fi
  ttl_lines=$(wc -l < "$ttls_tmp" | tr -d ' ')
  if [ "$ttl_lines" -ne "$total" ]; then
    echo "FATAL: TTL count ${ttl_lines} != blob count ${total} (alignment broken) — aborting" >&2; exit 1
  fi
fi

paste "$blobs_tmp" "$ttls_tmp" | awk -F'\t' \
  -v cutoff="$cutoff_ttl" -v pfx="${PREFIX}blob:" -v reffile="$REF" -v sumf="$sum_tmp" '
  BEGIN { while ((getline r < reffile) > 0) ref[r] = 1 }
  {
    key = $1; ttl = $2 + 0
    id = substr(key, length(pfx) + 1)
    if (id in ref)             { referenced++; next }   # live staged job — keep
    if (ttl <= 0 || ttl >= cutoff) { young++;  next }   # recent / in-flight — keep
    orphans++; print key                                # unreferenced + aged — reclaim
  }
  END { printf "referenced=%d young_skipped=%d orphans=%d\n", referenced, young, orphans > sumf }
' > "$OUT"

. "$sum_tmp" 2>/dev/null || true
referenced="${referenced:-0}"; young_skipped="${young_skipped:-0}"; orphans="${orphans:-0}"

# Estimate freed memory from a sample of up to 200 orphans (best-effort).
est_bytes=0
if [ "$orphans" -gt 0 ]; then
  avg=$(head -200 "$OUT" | while IFS= read -r k; do $R MEMORY USAGE "$k"; done \
        | awk '{s+=$1; n++} END {if (n) printf "%d", s/n; else print 0}')
  est_bytes=$(( avg * orphans ))
fi
est_mb=$(( est_bytes / 1024 / 1024 ))
echo "total_blobs=${total} referenced_kept=${ref_count} (live=${referenced}) young_kept=${young_skipped} orphans_to_reclaim=${orphans} est_freed=${est_mb}MB"

# Chunk plan (how the progressive reclaim would step through the orphans).
chunks=0; per_chunk_mb=0
if [ "$orphans" -gt 0 ]; then
  chunks=$(( (orphans + FREE_CHUNK - 1) / FREE_CHUNK ))
  per_chunk_mb=$(( est_mb * FREE_CHUNK / orphans ))
fi

if [ "$APPLY" != "1" ]; then
  echo "DISCOVER only — nothing mutated."
  echo "plan: reclaim ${orphans} orphan(s) in ${chunks} chunk(s) of ${FREE_CHUNK} (~${per_chunk_mb}MB/chunk, ${SLEEP}s pause between)"
  echo "list: ${OUT} (first 3):"; head -3 "$OUT" || true
  echo "to free: APPLY=1 [FORCE=1] [FREE_CHUNK=N] [SLEEP=N] [LIMIT=N] ... (FORCE=1 to run on a live system; LIMIT caps this run)"
  exit 0
fi

# ── 3. Apply: progressive chunked reclaim with memory reporting ──────────────
[ "$orphans" -eq 0 ] && { echo "nothing to reclaim"; exit 0; }

# Fail closed on a suspiciously empty reference set — a silent ref-build miss
# would otherwise classify every live blob as an orphan.
if [ "$ref_count" -eq 0 ] && [ "${ALLOW_EMPTY_REF:-0}" != "1" ]; then
  echo "FATAL: reference set is empty — refusing to APPLY (set ALLOW_EMPTY_REF=1 only if the queue truly has no blob-backed staged jobs)" >&2; exit 1
fi

# Quiescence guard: a blob dispatched DURING the sweep is unreferenced but a
# worker is about to read it (see header). Refuse while groups are processing
# unless FORCE=1 (a hit is recoverable via event replay, but make it explicit).
active=$($R --scan --pattern "${PREFIX}group:*:active" --count "${SCAN_COUNT:-1000}" | wc -l | tr -d ' ')
if [ "$active" -gt 0 ] && [ "${FORCE:-0}" != "1" ]; then
  echo "FATAL: ${active} group(s) currently processing — an in-flight blob could be hit." >&2
  echo "  Quiesce first: pause the queues and wait for ${PREFIX}group:*:active to reach 0, then APPLY." >&2
  echo "  Or set FORCE=1 to proceed now (a hit is recoverable via event replay)." >&2
  exit 1
fi
[ "$active" -gt 0 ] && echo "WARNING: FORCE=1 with ${active} active group(s) — any in-flight blob hit will replay from ClickHouse"

to_reclaim="$orphans"
if [ -n "$LIMIT" ] && [ "$LIMIT" -lt "$to_reclaim" ]; then to_reclaim="$LIMIT"; fi
mem0=$($R INFO memory | awk -F: '/^used_memory:/{print $2+0}')
echo "reclaiming ${to_reclaim}/${orphans} in chunks of ${FREE_CHUNK} (UNLINK batch ${BATCH}); used_memory=$(( mem0/1024/1024 ))MB"

done_n=0; reclaimed=0; unlink_fail=0
while [ "$done_n" -lt "$to_reclaim" ]; do
  start=$(( done_n + 1 )); end=$(( done_n + FREE_CHUNK ))
  [ "$end" -gt "$to_reclaim" ] && end="$to_reclaim"
  sed -n "${start},${end}p" "$OUT" > "$slice_tmp"
  # UNLINK (non-blocking; async free). Capture xargs status separately from the
  # reply sum so a real command error is tracked, not masked.
  set +e
  xargs -n "$BATCH" $R UNLINK < "$slice_tmp" > "$unlink_tmp" 2>/dev/null
  xs=$?
  set -e
  [ "$xs" -ne 0 ] && unlink_fail=$(( unlink_fail + 1 ))
  chunk_removed=$(awk '{s+=$1} END {print s+0}' "$unlink_tmp")
  reclaimed=$(( reclaimed + chunk_removed ))
  done_n="$end"
  memn=$($R INFO memory | awk -F: '/^used_memory:/{print $2+0}')
  echo "  attempted=${done_n}/${to_reclaim} keys_removed=${reclaimed} used_memory=$(( memn/1024/1024 ))MB freed_so_far=$(( (mem0-memn)/1024/1024 ))MB"
  [ "$done_n" -lt "$to_reclaim" ] && [ "$SLEEP" -gt 0 ] && sleep "$SLEEP"
done

remaining=$($R --scan --pattern "${PREFIX}blob:*" --count "${SCAN_COUNT:-1000}" | wc -l | tr -d ' ')
mem_final=$($R INFO memory | awk -F: '/^used_memory:/{print $2+0}')
echo "DONE attempted=${done_n} keys_removed=${reclaimed} unlink_cmd_failures=${unlink_fail} remaining_blobs=${remaining} used_memory=$(( mem_final/1024/1024 ))MB"
if [ "$unlink_fail" -gt 0 ]; then
  echo "WARN: ${unlink_fail} UNLINK batch(es) errored — re-run to retry the remainder" >&2
  exit 1
fi
exit 0
