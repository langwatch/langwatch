# ADR-024: Cold-path tiered storage for retention-managed tables

**Date:** 2026-06-01

**Status:** Accepted

## Context

ADR-022 stamps `_retention_days` on every row and lets ClickHouse-native TTL
drop expired rows at merge time. That covers the *deletion* half of retention.
The *storage cost* half — what we pay to keep N days of data on hot SSD versus
cheaper object storage — is a separate, operator-facing concern.

Three forces shape the cold path:

1. **Tail-heavy access.** 99%+ of queries hit the last few weeks of data.
   Anything older is read rarely (retroactive reads, audit, slow customers)
   but still has to exist. Paying provisioned-SSD prices for cold data
   triples the per-TB cost of keeping it.
2. **Hot-disk pressure.** Local SSDs are bounded; without a release valve,
   a populated cluster eventually fills the hot disk and writes start
   failing. We need the system to spill cold data without operator
   intervention.
3. **Operator-shape variability.** Self-hosted installs may not have S3,
   may use a different object store (GCS, R2, MinIO), or may not want
   tiered storage at all. The same migrations and the same retention
   enforcement have to run with or without cold storage.

ClickHouse already supports tiered storage natively (multi-volume storage
policies + `TTL ... TO VOLUME ...`). The question is how to wire it into
our chart, our image, and our reconciler so that it composes cleanly with
ADR-022's row-level retention without forcing every deployment to pay for
S3.

## Decision

We will operate two **independent TTL clauses** per retention-managed
table:

```sql
-- Retention DELETE. Always reconciled when CH is configured.
IF(_retention_days > 0,
   toDateTime(<retentionCol>) + toIntervalDay(_retention_days),
   toDateTime('2106-01-01'))
DELETE

-- Cold MOVE. Operator opt-in via CLICKHOUSE_COLD_STORAGE_ENABLED=true.
toDateTime(<coldCol>) + INTERVAL <hotDays> DAY TO VOLUME 'cold'
```

The `local_primary` storage policy has two volumes — `hot` on local SSD,
`cold` on an S3 object disk with a local SSD cache. Data ages hot → cold
by time (cold-day count from env vars), then expires by `_retention_days`
(per-row, from the ADR-022 cascade). The retention DELETE clause is the
only enforcement of retention; the cold MOVE clause is a storage-cost
optimization that can be enabled or disabled independently.

The cold path is **deployment shape**, not a customer-facing feature.

### Topology

```
ingest ─► hot volume (local SSD)
              │
              │  TTL: <coldCol> + INTERVAL <hotDays> DAY TO VOLUME 'cold'
              ▼
          cold volume (object disk, type=s3, cache on local SSD)
              │
              │  TTL: IF(_retention_days > 0, …, '2106-01-01') DELETE
              ▼
          (part dropped on next TTL merge → S3 objects freed)
```

### Rolling out on a populated cluster

The retention machinery is safe to ship onto a 100 TB cluster because
every step that touches all tables is metadata-only. No path
auto-rewrites existing parts on deploy.

| Step | What it does | Cost on populated tables |
|---|---|---|
| Migration 00032 `ADD COLUMN _retention_days UInt16 DEFAULT 308` | Records the column + DEFAULT in table metadata. `SETTINGS alter_sync = 1, mutations_sync = 0` waits only for the local replica's metadata update. | **Seconds.** Existing parts have no column file on disk; reads evaluate DEFAULT lazily. New inserts include the column. Merges drift it onto disk over time. |
| Migration 00032 `ADD COLUMN _size_bytes UInt32 MATERIALIZED byteSize(...)` | Same shape — formula stored in metadata, computed lazily on read for old parts, at insert time for new ones. | **Seconds.** |
| Reconciler `MODIFY TTL` (every deploy) | `SETTINGS materialize_ttl_after_modify = 0` — records the new TTL expression in metadata, does NOT queue a per-part mutation. | **Seconds.** |
| First ~24h after deploy | CH's TTL-merge scheduler (`merge_with_ttl_timeout`, default 24h) walks parts in normal interleaved merge order. Parts past TTL get evaluated and dropped/moved. | **Bounded by CH's merge concurrency settings**, not by part count. No thundering herd. |

The avalanche we don't fire: with `materialize_ttl_after_modify = 1` (CH's
default), `MODIFY TTL` would queue a mutation per part to evaluate TTL
immediately — on 100 TB that's tens of thousands of mutations, one S3
GET per cold part. We always pass `= 0` to stay in metadata-only mode.

The only path that DOES scale with data size is the retroactive UPDATE
(`ALTER TABLE … UPDATE _retention_days = N`) from ADR-022. That's
user-triggered, gated by the concurrent-mutation guard, shows a
parts-remaining countdown, and is cancelable. It never auto-fires on
deploy.

### Lifecycle — who deletes what, and when

The key fact is that TTL clauses live on the table, not on a volume.
ClickHouse's `MergeTreeBackgroundExecutor` evaluates TTL on every merge
for every part, hot or cold. Cold parts are full citizens of the merge
scheduler; the only difference is the bytes live in S3 instead of local
SSD.

Steady state, with retention=70d, cold=49d:

| Age | Where | What happens |
|---|---|---|
| 0 → 49d | `hot` volume | New parts written here. Merges evaluate both TTL clauses; neither expired. |
| Day 49 | hot → cold | Next merge after the MOVE clause expires copies the part to the S3 object disk. Metadata stays in CH; bytes move. Local cache may keep the part hot for reads. |
| 49 → 70d | `cold` volume | Parts continue to be merged by the same scheduler. DELETE clause evaluates per merge against `_retention_days`. Not expired yet. |
| Day 70 | cold → ∅ | Next TTL merge fires the DELETE clause. CH evaluates `_retention_days` per row (reads via cache → S3 fallback). When every row in the part is expired, the part is **dropped** — which on an S3-backed disk frees the underlying S3 objects via the storage policy's normal part-drop path. |

TTL-only merges are scheduled by `merge_with_ttl_timeout` (CH default
24h, we don't override), so expired parts disappear within ~24h of TTL
passing, not instantly. No app cron, no `DELETE FROM`, no per-part S3
API call from us — CH owns the deletion path end-to-end.

For retroactive shrink (e.g. 70d → 35d on day 60), see ADR-022 §
Retroactive. The mutation rewrites parts across all volumes, including
cold ones. Cost: S3 GET + decompress + recompress + PUT per cold part.
After the mutation finishes, the TTL DELETE re-evaluates on the next
TTL merge (~24h cycle).

A few non-obvious consequences:

- **Saving a policy alone never changes S3.** The retroactive UPDATE is
  a separate, explicit user action. Without it, only new inserts get
  the new `_retention_days`.
- **Step 2 is the only thing expensive on the cold path.** Steady-state
  TTL deletion is cheap (merge runs anyway). Retroactive shrink on a
  tenant with TB of cold data pays S3 egress/ingress per part.
- **TTL is not instant after the mutation.** Even after the rewrite
  finishes, parts wait for the next TTL merge cycle (~24h) before
  they're actually dropped. The mutation rewrites the column; the
  merge does the delete.
- **Expanding retention does not resurrect dropped data.** A 35d → 100d
  change rewrites surviving rows; parts already dropped on day 35 stay
  dropped.

### Layers

**Chart** (`charts/clickhouse-serverless/values.yaml`): one boolean
(`cold.enabled`) plus a shared `objectStorage` block (bucket / region /
endpoint, IRSA-capable credentials). Helm `fail`s the install if
`cold.enabled || backup.enabled` and `bucket` + (`region` or `endpoint`)
aren't set (`templates/_helpers.tpl`). When cold is on, the statefulset
gets `COLD_STORAGE_ENABLED=true` plus the shared S3 env (`S3_ENDPOINT`,
`S3_BUCKET`, `S3_REGION`).

**Image** (`clickhouse-serverless/internal/storage/storage.go`): Go
program in the entrypoint renders the CH `storage_configuration` YAML
from env, writes
`/etc/clickhouse-server/config.d/storage.yaml`, then execs CH. For
`COLD_STORAGE_ENABLED=true` it emits a local disk + an S3 object disk
(with a local SSD cache sized to 25% of pod RAM) and a `local_primary`
policy with `hot` + `cold` volumes (move_factor default 0.9).

**Bootstrap + reconciler** (`langwatch/src/server/clickhouse/`):
`goose.ts:320` queries `system.storage_policies` at startup. If
`local_primary` is present, migrations get `SETTINGS storage_policy =
'local_primary'`; otherwise the setting is left empty. Same migrations
run on prod (tiered) and local dev (default policy).
`ttlReconciler.ts` runs on every deploy, queries
`system.tables.engine_full` per managed table, and reconciles:

```ts
if (storage_policy !== 'local_primary' || !COLD_STORAGE_ENABLED) {
  // retention-only branch: install/refresh DELETE clause if missing
} else {
  // tiered branch: re-emit BOTH cold MOVE + retention DELETE atomically
}
```

Cold-day count resolution: `CLICKHOUSE_COLD_STORAGE_<TABLE>_TTL_DAYS` >
`CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS` > `hardcodedDefault: 49`.
`<ttlColumn>` is the cold-anchor per table (e.g. `EndTime` for spans);
separate from `retentionTTLColumn` (the immutable business timestamp).

### Invariants

| Invariant | Why |
|---|---|
| Retention reconciles whenever `CLICKHOUSE_URL` is set | Self-hosted installs without cold storage still need retention. Closed reviewer P1 (`PRRT_kwDOKRXhvM6GMdj8`). |
| Cold MOVE only on `local_primary` policy + `CLICKHOUSE_COLD_STORAGE_ENABLED=true` | `TO VOLUME 'cold'` is invalid on tables not on a tiered policy. |
| `MODIFY TTL` re-emits **both** clauses atomically when both apply | `MODIFY TTL` replaces the whole expression. Re-emitting only one drops the other. |
| Cold-day count is week-aligned | Tables partition by `toYearWeek(...)`; non-week-aligned values straddle partitions. |

All three have regression tests in `ttlReconciler.regression.unit.test.ts`.

## Rationale / Trade-offs

The independent two-clause design is the load-bearing choice. We could
have made retention conditional on cold storage (deletion only applies
to data on cold), or we could have made the cold MOVE always-on whenever
S3 is configured. We chose neither:

- **Retention has to enforce even without cold storage.** Most
  self-hosted installs don't run S3-tiered storage. Gating retention
  on cold would silently skip deletion for them (this was the open P1
  thread we closed). Retention is the customer-facing contract; cold
  is a cost optimization.
- **Cold has to be opt-in.** Many installs don't want the S3 bill or
  the operational surface (IRSA, bucket lifecycle, S3 outage
  consequences). Defaulting cold on would either force a config
  decision on every operator or fail-closed at install time.

Splitting them lets one work without the other. The cost is two TTL
clauses to keep in sync — addressed by the atomic re-emit invariant.

Other trade-offs:

- **Storage policy is fixed at table creation.** Re-tiering an
  existing un-tiered table requires recreate-and-copy. Migrations
  install `local_primary` only when present at install time; flipping
  a deployment from non-tiered → tiered after data exists is a manual
  operation.
- **Cold reads are slower.** S3 GET + decompress vs local mmap. The
  per-pod local cache (sized to 25% RAM) absorbs warm reads. Truly
  cold queries (random old `traceId` lookups) eat the latency.
  Acceptable given the tail-heavy access pattern.
- **Cache is per-pod.** A multi-replica install warms N caches
  independently. Replicated tables share parts metadata but each
  replica fetches and caches independently.
- **`move_factor` is per-policy.** Can't be tuned per table; the
  heaviest table sets the floor.
- **`backup.enabled` and `cold.enabled` share `objectStorage`.** One
  bucket. Easier ops (one IRSA, one credential) but no way to split
  cold from backup buckets without two helm installs.

## Consequences

**Positive.** Tenants on the tiered deployment pay ~10× less per GB for
data past the active window. Hot disks stay small even on
heavy-ingest tenants because `move_factor` proactively spills the
largest parts. ClickHouse owns the deletion path end-to-end; the
application never issues `DELETE FROM`. Self-hosted installs without
S3 keep working unchanged — retention enforces, cold is just inactive.

**Negative.** Retroactive shrink on a tenant with TB of cold data is a
long-running mutation paying S3 egress/ingress per part — slow and
expensive. The concurrent-mutation guard prevents double-trigger, but
the operation itself can't be cheap. The two-clause design adds
ongoing maintenance surface (the atomic re-emit invariant must be
preserved on every reconciler change); we mitigate with regression
tests.

**Neutral.** TTL evaluation is bounded by CH's merge scheduler, not by
data size on deploy. The first TTL merge wave after a 100 TB rollout
plays out over hours, but throttled — not as a thundering herd.

## Failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| Hot disk fills | CH proactively moves largest parts to cold via `move_factor` | Already the design. Lower `move_factor` if it's still not enough. |
| Hot disk past `keep_free_space_bytes` | Writes refused | Raise PVC size, lower `move_factor`, or shrink cold TTL. |
| S3 unavailable | Cold reads fail; writes (always hot) unaffected | CH retries; cache absorbs warm reads. |
| Reconciler drops retention TTL | Data lives past policy | Re-emit invariant + regression test. |
| Tables created without `local_primary`, then `cold.enabled=true` later | No-op; tiering doesn't apply retroactively | Detected at bootstrap; operator rebuilds tables. |

## Open questions

- **Cold-mutation cost preview.** UI shows the parts-remaining countdown
  but not estimated S3 bytes / $ for the operation. Tenants shrinking
  large cold footprints can't preview the cost before kicking off
  retroactive shrink.
- Per-tenant bucket prefixes for residency / per-tenant cold expiry.
- Per-table `move_factor` if hot/cold imbalance becomes a problem.
- Cache-size knob exposed at chart level (today: 25% RAM, computed).
- Egress costs on cross-AZ / cross-region cold placement — operator's
  deployment shape.

## References

- Related ADRs: ADR-022 (data retention, umbrella), ADR-023
  (orphan-sweep reactor + chain)
- Chart: `charts/clickhouse-serverless/{values.yaml,
  templates/statefulset.yaml, templates/_helpers.tpl}`
- Image: `clickhouse-serverless/internal/{config,storage,render}/`
- Bootstrap: `langwatch/src/server/clickhouse/goose.ts`
- Reconciler: `langwatch/src/server/clickhouse/ttlReconciler.ts`
- Tests:
  - `langwatch/src/server/clickhouse/__tests__/ttlReconciler.{unit,regression.unit}.test.ts`
  - `clickhouse-serverless/internal/storage/storage_test.go`
  - `clickhouse-serverless/tests/e2e-cold{,-move}-test.sh`
  - `charts/clickhouse-serverless/tests/e2e.sh` (`test_cold_storage`)
- CH docs: [Multiple volumes](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-multiple-volumes),
  [MOVE partitions](https://clickhouse.com/docs/en/sql-reference/statements/alter/partition#move-partition-part)
- PR: #4147
