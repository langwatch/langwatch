# ADR-089: Per-tenant per-category data retention enforced by ClickHouse-native TTL

**Date:** 2026-06-01

**Status:** Accepted — but the **orphan-cleanup half** described here (the PG-side sweep of rows referencing TTL-expired traces) was **removed** on 2026-06-03; see "Orphan sweep: added, then removed" below (originally its own ADR-025, absorbed into this document on 2026-07-30). The ClickHouse-native TTL retention below remains in force; mentions of the "orphan sweep" / "orphan-cleanup" are historical.

## Context

ClickHouse holds 11 hot-path tables that grow with tenant traffic (`event_log`,
`stored_spans`, `stored_log_records`, `stored_metric_records`, `trace_summaries`,
`evaluation_runs`, `dspy_steps`, `simulation_runs`, `suite_runs`,
`experiment_runs`, `experiment_run_items`). Until this work the platform had no
mechanism to age data out, so storage costs scaled linearly forever and every
tenant got the same fate regardless of plan or category.

**Note (log-write retirement):** `stored_log_records` is now read-only and
draining. The log write chain was retired — canonical `log_records` is the only
log write path — so no new rows are stamped into `stored_log_records`; its
existing TTL drains the pre-cutover history. It stays in the list above as a
table the TTL still governs, not a live write target.

The design space had four hard constraints:

1. **Per-tenant, per-category.** A free org and a paid org share the same
   physical tables on the warike cluster — partitioning per-tenant is a
   non-starter (one cluster, 11 weekly-partitioned tables, thousands of
   tenants). A category-coarser policy (one retention for everything) is also
   wrong: a customer can want 49 days of traces but 1 year of evaluation runs.

2. **No platform-side cron/worker driving deletes.** Issuing `DELETE FROM …`
   per tenant per category creates a long-running mutation queue; on a shared
   cluster, mutations are expensive (whole-part rewrites on merge) and one
   slow tenant starves others.

3. **Default-on, not opt-in.** Absence of a configured policy means "use the
   platform default", not "keep indefinitely". Indefinite retention is a real
   capability, but a platform-admin-only one (not a customer tier).

4. **Multi-instance + shared cluster.** LangWatch runs N k8s replicas; any
   policy change has to propagate to every ingest-handling pod without
   instance-local state. Reconciler-style logic on the cluster must be
   idempotent.

The orphan-cleanup half of this — PG rows referencing CH traces that TTL
deletes — has a distinct enough shape that it is addressed as its own section
below, "Orphan sweep: added, then removed".

## Decision

We will enforce retention by stamping a per-row `_retention_days UInt16`
column at ingest, resolved from a cascade `PROJECT > TEAM > ORGANIZATION >
49-day platform default`, with a single `TTL … DELETE` clause per table doing
the actual deletion at merge time. The TTL clause is installed by an
idempotent reconciler on every deploy; retroactive policy changes rewrite
`_retention_days` via `ALTER TABLE … UPDATE`.

This shape rests on three load-bearing choices.

**Row-level retention, not partitioned-per-policy.** Every row carries 2
bytes of `_retention_days` plus Delta+ZSTD codecs that collapse uniform
partitions to ≈0 bytes (RFC #19953 sparse encoding). The alternative —
splitting tables by policy class — multiplies weekly partition count by
tenant × category and blows past the ~10k parts/table degradation point on
the shared cluster.

**TTL is the deleter.** Merge-time `TTL … DELETE` runs as part of CH's
normal merge operation: free at scan time, no separate driver, no cron. The
only mutations we ever issue are retroactive rewrites of the column itself,
never `DELETE FROM`. The reconciler installs the TTL clause; ClickHouse does
the work.

**Server-resolved everywhere.** Every authz gate and retroactive value
derives its inputs from the server-side cascade. The client never supplies a
retention value to an enforcement path. An earlier
draft of the retroactive endpoint accepted `newRetentionDays` from the
client; a reviewer P1 caught that a `project:update` caller could rewrite
all existing rows to any value without a matching saved rule. The endpoint
now derives the value via `policy.getResolvedForProject(input.projectId)`
and returns `appliedRetentionDays` so the UI shows the truth, not the form.

### Constants (`src/server/data-retention/retentionPolicy.schema.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `PLATFORM_DEFAULT_RETENTION_DAYS` | 49 | What new rows get stamped when no override resolves. Default-on. |
| `MIN_RETENTION_DAYS` | 49 | Floor for any override; below this, ClickHouse TTL churn ROI collapses. |
| `MAX_RETENTION_DAYS` | 65534 | UInt16 max, kept week-aligned. |
| `RETENTION_WEEK_DAYS` | 7 | Tables are weekly-partitioned; values must be multiples of 7. |
| `INDEFINITE_RETENTION_DAYS` | 0 | Sentinel. Platform-admin only. Maps to year-2106 TTL expiry. |
| `MIGRATION_DEFAULT_RETENTION_DAYS` | 308 | The `DEFAULT 308` in migration 00032. Only read by rows that pre-existed the column. Distinct from `PLATFORM_DEFAULT_RETENTION_DAYS`. |

The 49 / 308 distinction is load-bearing: **49** is what new rows get
stamped going forward; **308** is what pre-migration rows read lazily
because the column didn't exist when they were written.

### Schema

Migration 00032 adds two columns to each of the 11 managed tables, each
ALTER in its own goose `StatementBegin` block (CH rejects multi-statement
ALTERs):

```sql
ADD COLUMN `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
ADD COLUMN `_size_bytes` UInt32 MATERIALIZED byteSize(<payload cols>)
  CODEC(Delta(4), ZSTD(1))
```

Settings `alter_sync = 1, mutations_sync = 0` make the migration
metadata-only on the local replica. `IF NOT EXISTS` makes reruns no-ops.
Down migrations are commented out — rollback is manual.

Tables map to three categories that cascade independently
(`RETENTION_TABLE_CATEGORY_MAP`): `traces` (7 tables), `scenarios`
(2 tables), `experiments` (2 tables).

PG carries `RetentionPolicy(scopeType, scopeId, category, retentionDays)`
with a denormalized `organizationId` anchor for plan-gating and
invalidation queries.

### Resolution (`resolveRetentionDays.ts` + `retentionPolicyCache.ts`)

A pure function walks PROJECT → TEAM → ORG, first match per category wins,
falls back to 49 when no row anywhere in the chain. The result is never 0
— 0 is a TTL-expression sentinel, not a value the resolver returns.

Resolution is cached per project (60s TTL); mutations call
`findAffectedProjectIds(scope)` and `cache.invalidate(id)` per project. A
failed invalidate is best-effort; the 60s TTL is the upper bound on stale
reads.

### Enforcement (`ttlReconciler.ts`)

The reconciler runs from `clickhouseMigrate.ts` on every deploy, queries
`system.tables.engine_full` per managed table, and issues
`ALTER TABLE … MODIFY TTL … SETTINGS materialize_ttl_after_modify = 0`
only when the expression differs. Each table can carry two independent TTL
clauses:

```sql
-- always reconciles when CLICKHOUSE_URL is set
IF(_retention_days > 0,
   toDateTime(<retentionCol>) + toIntervalDay(_retention_days),
   toDateTime('2106-01-01'))
DELETE

-- only when CLICKHOUSE_COLD_STORAGE_ENABLED=true and policy=tiered
toDateTime(<coldCol>) + INTERVAL <hotDays> DAY TO VOLUME 'cold'
```

`MODIFY TTL` is atomic — it replaces the whole expression. So for managed
tables we always re-emit both clauses when the cold-storage one is in
play; otherwise bumping a hot-days env var silently drops the retention
DELETE clause. An earlier P1 had retention gated on cold storage too —
fixed: retention reconciles whenever CH is configured, cold-storage only
when `CLICKHOUSE_COLD_STORAGE_ENABLED=true`.

### TTL anchor and ADR-099's frozen-column rule

ADR-099 (written after this ADR) requires a TTL anchor to pass two tests at
once — frozen for the row's life, and set by the platform, never the
customer — and names `event_log`'s own TTL as the worked example of what
happens when it doesn't: `EventOccurredAt` is customer-supplied, so a skewed
producer clock scatters retention early or late and a future-stamped event can
outlive its 49 days entirely. `event_log` is in the managed-table list above
and its anchor has not changed since ADR-099 was written — the defect is
inherited, not new, and ADR-099 is where it is tracked.

`evaluation_analytics` fails the same test for a different reason: its anchor
column, also named `OccurredAt`, is stamped from the latest event by migration
00041 and therefore moves as an evaluation progresses (`schema-catalogue.ts`
records this as `partitionColumnStability: "movable"`) — platform-set, but not
frozen. `trace_analytics`'s identically-named `OccurredAt` is the contrast
case: ADR-071 made it a write-once storage anchor, frozen thereafter, so it
passes both tests despite the shared column name.

Neither case is a new finding surfaced here — ADR-099 documents `event_log`
directly, and the schema catalogue's own stability field documents
`evaluation_analytics`. Both predate ADR-099's rule and neither has been
re-anchored to comply with it; that re-anchoring is `defineTable`-era work
under ADR-099, not a change to the per-tenant retention design decided in this
ADR. This ADR's own rule — one TTL `DELETE` clause per table, anchored on
whatever column its author picked — does not disagree with ADR-099's stricter
test in principle; it simply predates it, and the two tables above are where
the two ADRs currently disagree in practice, tracked as ADR-099 follow-up
rather than restated here.

### Ingestion stamping

Every CH repository for the 11 managed tables takes a
`RetentionPolicyResolver` and stamps `_retention_days` per row:

```ts
const retentionDays =
  (await resolver?.getRetentionDays(tenantId, "traces"))
  ?? PLATFORM_DEFAULT_RETENTION_DAYS;
```

`_size_bytes` is `MATERIALIZED` — CH computes it server-side at insert
from the payload columns; the app must never pass it (CH rejects the row).
Floor is 49 in production; 0 is only acceptable in test fixtures for
backdated rows that would otherwise age out during a test.

### Retroactive (`retroactiveUpdate.service.ts`)

The endpoint derives the target value from the cascade and issues one
ALTER per affected table:

```sql
ALTER TABLE <t>
UPDATE _retention_days = {retentionDays:UInt16}
WHERE TenantId = {tenantId:String} AND _retention_days != {retentionDays:UInt16}
```

The `!= N` predicate skips parts already at target. Before issuing the
ALTER, we query `system.mutations` with
`position(command, escapedTenantFilter)` and reject the request if any
in-flight `_retention_days` mutation matches the tenant + target tables.
`escapeClickHouseStringLiteral` (`\\` → `\\\\`, `'` → `\\'`) mirrors how CH
stores the command string and closes a CodeQL incomplete-encoding flag for
project ids containing `'` or `\`.

### Storage metering (`storageMeter.service.ts`)

Per-tenant total is computed as per-table `sum(_size_bytes)` scalars
union-summed:

```sql
SELECT sum(t) AS total FROM (
  SELECT sum(_size_bytes) AS t FROM table_1 WHERE TenantId = {tenantId:String}
  UNION ALL
  ...
)
```

A naive `UNION ALL` on raw rows would materialize every `_size_bytes`
value into the intermediate set before summing — multi-GB intermediate on
large tenants. Per-table pre-aggregation collapses each table to one
scalar before the outer sum. Total cached 5min; breakdown queries each
table separately, per-table errors logged and skipped.

### Pinning (`pinnedTrace.service.ts`)

A `PinnedTrace` row exempts a single trace from retention TTL while the
row exists. Two interaction surfaces: `pin` (`source=manual`) and
`autoPin` (`source=share`, called by `createShare`). The two interact: a
user can share, then explicitly pin — the row's source becomes `manual`
while the share is still active.

The unpin guard is `hasActiveShareForTrace`, **not** `pin.source === share`
— an earlier version checked source and missed the share→manual promotion
path. The router translates `PinnedToActiveShareError` to tRPC `CONFLICT`;
the UI greys the unpin action and points at the share toggle.
`PinnedTraceService` and `ShareService` would form a cycle; broken by
injecting `hasActiveShareForTrace` as a predicate from `presets.ts`.

### Authorization

Four independent gates, asserted at the router. Read paths use the same
predicates to compute `writable` flags so the UI never offers a control
the save will reject.

| Gate | When | Failure |
|---|---|---|
| `assertCanWriteRetentionScope` | Always; per scope tier (`organization:manage` / `team:manage` / `project:update`) | FORBIDDEN |
| `assertRetentionPlanForScope` | Set/remove; plan-gates against the **scope-owning org** | FORBIDDEN |
| `assertCanDisableRetention` | Only when setting `INDEFINITE_RETENTION_DAYS`; `ADMIN_EMAILS` allow-list | FORBIDDEN |
| `checkProjectPermission("project:update")` | Retroactive endpoint | FORBIDDEN |

PROJECT-tier write uses `project:update` (not `manage`) to match the read
snapshot's `writable` flag. Plan gating uses `resolveScopeOrganizationId`,
not the caller-supplied projectId — an earlier draft was vulnerable to a
free-org / paid-project mixed-input bypass; reviewer caught it.

### Audit log

Every retention mutation is audited automatically via the
`auditLogMutations` tRPC middleware (`src/server/api/trpc.ts:640`), which
is wired into `protectedProcedure`. No retention-specific code needed.

Audited actions: `dataRetention.setForScope`, `dataRetention.removeForScope`,
`dataRetention.triggerRetroactiveUpdate`, `dataRetention.killMutation`,
`pinnedTrace.pin`, `pinnedTrace.unpin`.

Each row in `AuditLog` carries `userId` (impersonator stamped in
`metadata.impersonatorId`), `action` (the tRPC path), `args` (input
payload, truncated to 4KB), `organizationId` / `projectId` from input,
`ipAddress`, `userAgent`, `error`, plus `targetKind` / `targetId` derived
from the result. Surfaced through `/settings/audit-log`. Indexed on
`(organizationId, createdAt)` for forensics queries.

### Orphan sweep: added, then removed

ClickHouse-native TTL, above, drops trace rows at merge time. It does not
touch PostgreSQL rows that reference a trace by `traceId` — `Annotation`,
`AnnotationQueueItem`, `PublicShare`, `TriggerSent`, `PinnedTrace` — so those
rows can outlive the trace they point at.

The first answer to that gap was a per-tenant **orphan sweep**: an ingestion
reactor seeded a self-perpetuating BullMQ chain that walked candidates and
deleted them. That mechanism became the costly part of the system rather than
the cheap cleanup it was meant to be:

- It was the **direct trigger of the 2026-06-02 retention incident** (RC #2):
  a `:` in the BullMQ custom jobId was rejected, `QueueWithFallback` fell back
  to running the heavy sweep **inline on the ingestion path**, and ClickHouse
  was hammered per trace event.
- Containing and re-doing it consumed two follow-up efforts — a hot-fix and a
  full groupQueue migration (PR #4524) — for a feature whose only job was
  opportunistic cleanup of rows that are, at worst, dangling references in the
  UI.

The cost/benefit didn't hold, so on 2026-06-03 the sweep was **removed
entirely** — this removed only the PostgreSQL traceId-reference sweep; it did
not touch storage-level orphaned-trace cleanup (`cleanupOrphanedTraces` /
`cleanupOrphanedHotTraces`, invoked from `server/routes/cron.ts`, which
stays). Deleted: the `data-retention/orphan-sweep/` service, repository,
reactor and cursor store; the `orphanSweepChainQueue`/`orphanSweepChainWorker`
pair; and all wiring — the trace-processing reactor attach, the
`PipelineRegistry`/`DataRetentionDependencies` plumbing, the worker
registration, the `orphan_sweep_chain` job metric and the
`data_retention_orphans_swept_total` counter, and
`specs/data-retention/orphan-sweep.feature`. PR #4524 (the groupQueue
migration) was closed unmerged, superseded by the removal.

**Accepted negative.** PG rows that reference TTL-expired traces now accrue
indefinitely: an `Annotation`/`AnnotationQueueItem` for an expired trace
remains (may surface as an entry pointing at a trace that no longer loads); a
`PublicShare` of an expired trace remains (the link resolves to a missing
trace); `TriggerSent.traceId` keeps pointing at an expired trace; a
`PinnedTrace` of an expired trace remains, its pin resolving to nothing. These
are accepted as non-crashing phantoms; read-time handling, where worth it, is
deliberately out of scope and tracked as follow-ups (annotation phantom tasks
+ inflated queue counts → #4529; trigger suppression on same-project
trace-id reuse → #4530; public-share authorization not scoped to `projectId`,
a pre-existing cross-tenant concern independent of this removal → #4531).
Storage growth from the accrual is negligible relative to the trace volume
that drove this retention work in the first place.

**Positive.** The ingestion path can never again be coupled to a heavy
multi-table cleanup. One fewer queue, worker, reactor and Redis cursor to
operate. The retention story is now purely ClickHouse-native TTL, as
documented above.

**If it ever needs to come back**, prefer **read-time filtering** — skip/hide
PG rows whose trace no longer exists, at the point of display — over a
background deleter: it never couples to ingestion and only does work for rows
actually read. A one-off backfill cleanup op can handle accumulated rows if
storage ever matters. Either would earn its own ADR rather than reviving this
section's mechanism.

## Rationale / Trade-offs

**Default 49 days, not unlimited.** Default-on. Opting out is the paid
feature. Free orgs get the platform floor; nobody silently keeps data
forever just because they didn't visit the settings page.

**CH column `DEFAULT 308` for pre-migration rows.** The migration backfills
nothing; pre-existing rows read 308 lazily because the column didn't
exist when they were written. We chose generous (308 ≈ 10 months) over
aggressive so first rollout never shrinks data a customer didn't opt into
shrinking. This is the choice an open reviewer thread challenges
(P1, thread `PRRT_kwDOKRXhvM6GHkaq`); explicitly deferred from this PR
pending a separate platform-wide rollout decision.

**Cache staleness window 60s.** Mutations explicitly invalidate, so the
60s ceiling only applies to unrelated tenants. The alternative — pub/sub
invalidation across replicas — adds operational surface for a window we
already accept.

**Row-level vs partition-level retention.** Row-level wins on a shared
cluster because partition cardinality stays tenant-agnostic. The cost is
2 bytes per row before codec, ≈0 bytes after Delta+ZSTD on uniform parts.

**`_size_bytes` is payload-bytes, not disk-bytes.** Excludes codec/column
overhead and partition metadata. Relative metric for "how much does this
tenant write", not exact disk usage. Adequate for the storage breakdown
UI.

## Consequences

**Positive.** A new policy at any scope reaches every replica within 60s
via the cache TTL or immediately via explicit invalidation. ClickHouse
deletes rows at zero application cost. Retroactive policy changes are a
single per-table ALTER with no batching logic. The storage breakdown UI
gives tenants a real number, not an estimate.

**Negative.** A bug in the reconciler that drops the retention TTL
silently keeps data alive past policy — the underlying CH rows don't
expire. Mitigation: regression tests for the MODIFY-TTL re-emit
invariant, plus a check on every deploy.

A bug in ingestion stamping that floors to 0 instead of 49 silently makes
data indefinite for new inserts. Mitigation: `_retention_days = 0` is
only acceptable in test fixtures; production paths always fall back to
`PLATFORM_DEFAULT_RETENTION_DAYS`.

**Neutral.** Pinning growth is unbounded — manual pins survive until
explicitly unpinned. Since the orphan sweep was removed (see "Orphan sweep:
added, then removed" above), a pin's `PinnedTrace` row is no longer cleaned
when its trace TTLs out; it lingers as a stale reference. Acceptable given
expected pin volume.

## References

- Related ADRs: ADR-019 (repository-service layering). The orphan-sweep
  removal was originally its own ADR (023, superseded by 025), then 025 was
  itself absorbed as the section above on 2026-07-30 — see
  `dev/docs/adr/README.md`'s retired-numbers table for the full chain.
- Migration: `platform/app/src/server/clickhouse/migrations/00032_add_retention_and_size_columns.sql`
- Code: `platform/app/src/server/data-retention/`,
  `platform/app/src/server/clickhouse/ttlReconciler.ts`,
  `platform/app/src/server/api/routers/dataRetention.ts`,
  `platform/app/src/pages/settings/data-retention.tsx`
- Specs: `specs/data-retention/`
- PR: #4147
