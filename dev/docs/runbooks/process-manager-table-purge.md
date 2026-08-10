# One-time purge of the ProcessManager inbox and outbox tables

> **Why this exists**: the automations process manager writes one durable
> `ProcessManagerInbox` row per (trigger x trace x debounce bucket) and one
> `ProcessManagerOutbox` row per settled intent, and until the retention sweep
> shipped, nothing ever deleted them. The tables grew ~3.6 GB in twenty days on
> a 20 GiB instance with storage autoscaling off, which put the database weeks
> away from a write outage. The sweep stops the growth going forward, and it
> clears the historical backlog on its own: its per-wake budget opens at 25,000
> rows per family and doubles every hour, so the catch-up is spread across
> roughly a day instead of landing on the instance in one wake.
>
> This runbook is the supervised version of that same catch-up. It clears the
> backlog in a single pass while somebody is watching the instance, which leaves
> the sweep with only the interim to absorb.

## When to run

Ideally once, immediately before the deploy that carries the retention sweep.
This is an accelerator, not a prerequisite: the sweep ramps its own budget, so a
deploy that lands first, or a purge that fails halfway, leaves the backlog to
drain over about a day rather than leaving the database exposed. Running the
purge first is still worth it:

- The purge does the bulk work with `ctid` batches, which need no index. The
  index builds in step 5 then have only the few surviving live rows to sort
  and write, instead of two million dead ones. (The heap files stay their old
  size, since a plain `VACUUM` only marks pages reusable, but the entries an
  index build actually processes are the live tuples.)
- The sweep's first tick after deploy then has only the interim backlog to
  drain, which its bounded batches handle comfortably.

If the deploy has already landed, the purge is still safe to run. It just
overlaps with a sweep that is working through the same rows more slowly.

## What gets deleted, and why it is safe

| Table | Predicate | Why safe |
|---|---|---|
| `ProcessManagerOutbox` | `status='dispatched' AND "dispatchedAt" < now() - 7 days` | A dispatched row is completed work. Its only remaining value is forensic, and seven days is well past any window in which anyone reads it. Pending and dead rows are never touched: pending rows are work still owed, dead rows are the operator's failure record. |
| `ProcessManagerInbox` | `"consumedAt" < now() - 7 days` | An inbox row is an idempotency marker. It only has to outlive the window in which the same source event could be redelivered. That horizon is about 25 hours: origin guards reject events older than 1 hour and traces older than 24 hours, and the longest debounce bucket is 600 seconds. Seven days is a wide margin on top, and `TriggerSent` claims are a second layer against a double side effect even if a marker were dropped too early. |

`ProcessManagerInstance` is deliberately **not** purged. It is bounded by entity
population rather than by traffic (16 MB against 2.1 GB of inbox), and deleting
an instance row resets its revision and state, which is a correctness hazard
rather than a cleanup.

## Access path

No psql bastion is needed. `platform/app/scripts/ops/purge-process-manager-tables.mjs`
runs inside an app pod, which already has the Prisma client and the database
credentials. Nothing here needs a new credential or a new network route.

## Procedure

Run off-peak.

### 1. Baseline

Record the starting position so the effect is measurable:

```sql
SELECT
  (SELECT count(*) FROM "ProcessManagerOutbox") AS outbox_rows,
  (SELECT count(*) FROM "ProcessManagerOutbox" WHERE "status" = 'dispatched') AS outbox_dispatched,
  (SELECT count(*) FROM "ProcessManagerOutbox"
     WHERE "status" = 'dispatched'
       AND "dispatchedAt" < now() - interval '7 days') AS outbox_eligible,
  (SELECT count(*) FROM "ProcessManagerInbox") AS inbox_rows,
  (SELECT count(*) FROM "ProcessManagerInbox"
     WHERE "consumedAt" < now() - interval '7 days') AS inbox_eligible,
  pg_size_pretty(pg_total_relation_size('"ProcessManagerOutbox"')) AS outbox_size,
  pg_size_pretty(pg_total_relation_size('"ProcessManagerInbox"')) AS inbox_size;
```

The two `*_eligible` columns count exactly what the purge's predicates will
delete (adjust the interval if you override `RETENTION_DAYS`), so they should
match the dry-run's report and read zero after the apply. The totals will not
drop nearly as far; step 4 explains what they keep.

### 2. Dry-run the purge

The script is dry-run by default: it reports how many rows each predicate
matches and deletes nothing.

```bash
kubectl --context lw-prod -n langwatch exec -it deploy/langwatch-app -- \
  node scripts/ops/purge-process-manager-tables.mjs
```

### 3. Apply

```bash
kubectl --context lw-prod -n langwatch exec -it deploy/langwatch-app -- \
  env APPLY=1 node scripts/ops/purge-process-manager-tables.mjs
```

It deletes 10,000 rows per statement, sleeps 200 ms between batches so the purge
never monopolises the instance, loops until a batch returns 0, and then runs a
plain `VACUUM (ANALYZE)` on both tables. `RETENTION_DAYS`, `BATCH_SIZE`,
`SLEEP_MS` and `MAX_BATCHES` are env overrides.

The loop also stops early once a table hits `MAX_BATCHES` (default 10,000
batches, or 100M rows — far above any expected backlog) and warns rather than
fails. If that warning appears, eligible rows were left behind: run the script
again, or raise `MAX_BATCHES`.

Interrupting it is safe. Every batch is its own statement, so a stopped run just
leaves the rest of the backlog for the next run or for the sweep.

The delete it issues is `ctid`-batched, which is what makes this work without an
index: the subquery picks physical row locations off a sequential scan, so there
is no dependency on the indexes, which do not exist until step 5 builds them.

```sql
WITH batch AS (
  SELECT ctid FROM "ProcessManagerOutbox"
  WHERE "status" = 'dispatched'
    AND "dispatchedAt" < now() - interval '7 days'
  LIMIT 10000
)
DELETE FROM "ProcessManagerOutbox" o USING batch WHERE o.ctid = batch.ctid;
```

**Never run `VACUUM FULL` on these tables.** It takes an ACCESS EXCLUSIVE lock
for the whole rewrite, which blocks every reader and writer of a table the
automations pipeline writes to continuously.

### 4. Verify

Re-run the baseline query from step 1.

Expect both `*_eligible` counts to be **zero**, and the totals to drop to
roughly the last seven days of traffic: the purge keeps `RETENTION_DAYS` of
history, and pending and dead outbox rows are never touched. The tighter
24-hour steady state for dispatched rows arrives later, once the deploy's
hourly sweep takes over with its own windows.

Expect the reported **file sizes to stay the same**. That is the intended
outcome, not a failed purge: a plain `VACUUM` marks pages reusable rather than
returning them to the filesystem, so Postgres refills them with new rows
instead of extending the files. The goal is for growth to stop, not for the
numbers to shrink.

To confirm the space really is reusable rather than merely still allocated:

```sql
SELECT relname, n_dead_tup, n_live_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('ProcessManagerOutbox', 'ProcessManagerInbox');
```

`n_dead_tup` should be near zero after the vacuum.

### 5. Build the sweep's indexes

The sweep reaps by age across every process name, which neither table's
existing indexes can answer: the outbox indexes lead on `status` or
`processName`, and 99.98% of outbox rows are `dispatched`, so an age predicate
without these indexes falls back to scanning. The sweep still works without
them, just with sequential scans over tables it keeps bounded, so these builds
are an optimisation, not a prerequisite.

They are deliberately **not** in a Prisma migration. `prisma migrate deploy`
runs a plain `CREATE INDEX`, which holds a `SHARE` lock that blocks every
`INSERT` on these tables for the whole build, and these are the two
highest-volume insert paths in the system. A timeout only caps the damage; it
does not remove it. `CREATE INDEX CONCURRENTLY` builds without blocking
writes, but cannot run inside the transaction Prisma applies migrations in,
so it is an operator step:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessManagerOutbox_dispatchedAt_idx"
  ON "ProcessManagerOutbox"("dispatchedAt")
  WHERE "status" = 'dispatched';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessManagerInbox_consumedAt_idx"
  ON "ProcessManagerInbox"("consumedAt");
```

The outbox index is partial: restricted to `dispatched` rows it indexes
exactly the reap set, instead of adding write amplification for every pending
row on the hot insert path.

If a `CONCURRENTLY` build fails or is interrupted, it leaves an `INVALID`
index behind, and `IF NOT EXISTS` will then see it as present and skip it.
Check for that before trusting a re-run:

```sql
SELECT c.relname
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE NOT i.indisvalid AND c.relname LIKE 'ProcessManager%';
```

Drop any invalid index it reports, concurrently, since a plain `DROP INDEX`
takes an `ACCESS EXCLUSIVE` lock that blocks reads and writes on these same
hot tables:

```sql
DROP INDEX CONCURRENTLY IF EXISTS "<name>";
```

Run it outside an explicit transaction, then run the build again.

## After the deploy

The `processRetentionSweep` process manager takes over on an hourly schedule and
holds the tables at their steady state: dispatched outbox rows older than 24
hours, dead outbox rows older than 30 days, consumed inbox rows older than 7
days. Its first wake spends 5 batches per family and doubles that every hour up
to 200, so if any backlog is left the hourly swept counts roughly double for the
first seven hours and then flatten. Each wake logs the budget it was allowed as
`maxBatchesPerFamily`. Watch these for the first 48 hours:

- `process_manager_retention_swept_rows_total{family}` climbing every hour.
- Row counts for both tables flat, rather than resuming their previous slope.
- The oldest **pending** outbox row's age unchanged. The sweep must never touch
  pending work; if that age starts climbing, the sweep is deleting rows it
  should not.
- Zero increase in `duplicateEvent` commit outcomes, which is what deleting an
  inbox marker too early would look like.
