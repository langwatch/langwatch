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
#       the "r" field. This protects every STAGED job (normal, paused, retry-
#       backoff — all re-staged into the data hash), so their blobs are kept.
#   (b) AGED > MIN_AGE_HOURS — derived from the remaining TTL (age =
#       BLOB_TTL_SECONDS - ttl). This protects IN-FLIGHT jobs whose value left
#       the data hash at dispatch (so they look unreferenced) but whose blob a
#       worker is about to read. The processing window is bounded by the active
#       key TTL (~300s), so a multi-hour floor cannot hit a live in-flight blob.
# Canonical span data lives in ClickHouse and a missing blob is recoverable via
# event replay (decode throws -> slot completed -> replay), so (b) is belt-and-
# suspenders, not a correctness requirement.
#
# Usage (run co-located with redis, e.g. a redis:7-alpine pod like the drain pods):
#   H=<host> REDISCLI_AUTH=<pw> sh reclaim-orphaned-blobs.sh             # discover
#   H=<host> REDISCLI_AUTH=<pw> APPLY=1 sh reclaim-orphaned-blobs.sh     # reclaim
#   H=127.0.0.1 PORT=6390 TLS= sh reclaim-orphaned-blobs.sh             # local (no TLS)

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

# ── 1. Referenced blob ids ──────────────────────────────────────────────────
# Only a few hundred group hashes; HVALS each and pull the id out of every
# e:"ref" envelope. Base64 inline bodies cannot forge a "r":"<uuid>" match
# (no quotes/colons in base64), so this never over-counts.
: > "$REF"
$R --scan --pattern "${PREFIX}group:*:data" --count "${SCAN_COUNT:-1000}" | while IFS= read -r dk; do
  $R HVALS "$dk"
done | grep -oE '"r":"[0-9a-f-]{36}"' | sed 's/.*"r":"//; s/"$//' | sort -u > "$REF"
ref_count=$(wc -l < "$REF" | tr -d ' ')

# ── 2. Discover orphans (unreferenced AND aged) ─────────────────────────────
# Bulk-fetch every blob key + TTL in two pipelined passes, then classify
# locally against the referenced set — per-key round-trips would be 100K+.
blobs_tmp=$(mktemp); ttls_tmp=$(mktemp); sum_tmp=$(mktemp)
trap 'rm -f "$blobs_tmp" "$ttls_tmp" "$sum_tmp"' EXIT
$R --scan --pattern "${PREFIX}blob:*" --count "${SCAN_COUNT:-1000}" > "$blobs_tmp"
total=$(wc -l < "$blobs_tmp" | tr -d ' ')
# Fetch every blob's TTL in chunks via EVAL — per-key TTL round-trips would be
# 100K+ (≈hours over a WAN). Keys go in ARGV with numkeys=0: blob keys share the
# queue hash tag so they live in one slot, and this is a single-shard replication
# group, so there is no cross-slot concern. xargs preserves input order and EVAL
# returns ARGV order, so ttls_tmp stays line-aligned with blobs_tmp for paste.
: > "$ttls_tmp"
if [ "$total" -gt 0 ]; then
  TTL_LUA='local r={} for i=1,#ARGV do r[i]=redis.call("ttl",ARGV[i]) end return r'
  xargs -n "${CHUNK:-2000}" $R EVAL "$TTL_LUA" 0 < "$blobs_tmp" > "$ttls_tmp"
fi

paste "$blobs_tmp" "$ttls_tmp" | awk -F'\t' \
  -v cutoff="$cutoff_ttl" -v pfx="${PREFIX}blob:" -v reffile="$REF" -v sumf="$sum_tmp" '
  BEGIN { while ((getline r < reffile) > 0) ref[r] = 1 }
  {
    key = $1; ttl = $2 + 0
    id = substr(key, length(pfx) + 1)
    if (id in ref)             { referenced++; next }   # live staged job — keep
    if (ttl <= 0 || ttl >= cutoff) { young++;  next }   # in-flight / too young — keep
    orphans++; print key                                # unreferenced + aged — reclaim
  }
  END { printf "referenced=%d young_skipped=%d orphans=%d\n", referenced, young, orphans > sumf }
' > "$OUT"

. "$sum_tmp" 2>/dev/null || true
referenced="${referenced:-0}"; young_skipped="${young_skipped:-0}"; orphans="${orphans:-0}"

# Estimate freed memory from a sample of up to 200 orphans.
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
  echo "to free: APPLY=1 [FREE_CHUNK=N] [SLEEP=N] [LIMIT=N] ... (LIMIT caps this run for incremental freeing)"
  exit 0
fi

# ── 3. Apply: progressive chunked reclaim with memory reporting ──────────────
[ "$orphans" -eq 0 ] && { echo "nothing to reclaim"; exit 0; }
to_reclaim="$orphans"
if [ -n "$LIMIT" ] && [ "$LIMIT" -lt "$to_reclaim" ]; then to_reclaim="$LIMIT"; fi
mem0=$($R INFO memory | awk -F: '/^used_memory:/{print $2+0}')
echo "reclaiming ${to_reclaim}/${orphans} in chunks of ${FREE_CHUNK} (UNLINK batch ${BATCH}); used_memory=$(( mem0/1024/1024 ))MB"

done_n=0
while [ "$done_n" -lt "$to_reclaim" ]; do
  start=$(( done_n + 1 )); end=$(( done_n + FREE_CHUNK ))
  [ "$end" -gt "$to_reclaim" ] && end="$to_reclaim"
  # UNLINK this slice (non-blocking; async free). Tolerate a transient blip.
  set +e
  sed -n "${start},${end}p" "$OUT" | xargs -n "$BATCH" $R UNLINK >/dev/null 2>&1
  set -e
  done_n="$end"
  memn=$($R INFO memory | awk -F: '/^used_memory:/{print $2+0}')
  echo "  reclaimed=${done_n}/${to_reclaim} used_memory=$(( memn/1024/1024 ))MB freed_so_far=$(( (mem0-memn)/1024/1024 ))MB"
  [ "$done_n" -lt "$to_reclaim" ] && [ "$SLEEP" -gt 0 ] && sleep "$SLEEP"
done

remaining=$($R --scan --pattern "${PREFIX}blob:*" --count "${SCAN_COUNT:-1000}" | wc -l | tr -d ' ')
echo "DONE reclaimed=${done_n} remaining_blobs=${remaining} used_memory=$(( $($R INFO memory | awk -F: '/^used_memory:/{print $2+0}')/1024/1024 ))MB"
