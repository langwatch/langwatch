# One-time purge of the ProcessManager inbox and outbox tables

> **Why this exists**: the automations process manager writes one durable
> `ProcessManagerInbox` row per (trigger x trace x debounce bucket) and one
> `ProcessManagerOutbox` row per settled intent, and until the retention sweep
> shipped, nothing ever deleted them. The tables grew ~3.6 GB in twenty days on
> a 20 GiB instance with storage autoscaling off, which put the database weeks
> away from a write outage. The sweep stops the growth going forward. It does
> not, on its own, clear the backlog fast enough on a database that is already
> close to full, because the first sweep tick would try to delete millions of
> rows through the same bounded batches it uses for steady state.
>
> This runbook is the one-time catch-up: a manual batched purge that clears the
> historical backlog before the sweep takes over.

## When to run

Once, immediately before the deploy that carries the retention sweep. Running it
first is deliberate:

- The purge does the bulk work with `ctid` batches, which need no index. The
  migration in the same PR then builds a partial index on
  `("dispatchedAt") WHERE status='dispatched'` over a near-empty heap instead of
  over two million dead rows, so the index build is fast and its lock is short.
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

No psql bastion is needed. Run through an app pod, which already has the Prisma
client and the database credentials, using `$executeRawUnsafe` one statement per
call:

```bash
kubectl --context lw-prod -n langwatch exec -it deploy/langwatch-app -- \
  node -e '<script>'
```

Use the same access path the investigation used. Nothing here needs a new
credential or a new network route.

## Procedure

Run off-peak. Each statement below deletes at most 10,000 rows and returns the
count it actually deleted. Loop until a batch returns 0, sleeping between
batches so the purge never monopolises the instance.

### 1. Baseline

Record the starting position so the effect is measurable:

```sql
SELECT
  (SELECT count(*) FROM "ProcessManagerOutbox") AS outbox_rows,
  (SELECT count(*) FROM "ProcessManagerOutbox" WHERE "status" = 'dispatched') AS outbox_dispatched,
  (SELECT count(*) FROM "ProcessManagerInbox") AS inbox_rows,
  pg_size_pretty(pg_total_relation_size('"ProcessManagerOutbox"')) AS outbox_size,
  pg_size_pretty(pg_total_relation_size('"ProcessManagerInbox"')) AS inbox_size;
```

### 2. Purge the dispatched outbox

`ctid` batching is what makes this work without an index: the subquery picks
physical row locations off a sequential scan, so there is no dependency on the
index the migration has not built yet.

```sql
WITH batch AS (
  SELECT ctid FROM "ProcessManagerOutbox"
  WHERE "status" = 'dispatched'
    AND "dispatchedAt" < now() - interval '7 days'
  LIMIT 10000
)
DELETE FROM "ProcessManagerOutbox" o USING batch WHERE o.ctid = batch.ctid;
```

Repeat until it reports 0 rows deleted. Sleep ~200 ms between batches.

### 3. Purge the consumed inbox

```sql
WITH batch AS (
  SELECT ctid FROM "ProcessManagerInbox"
  WHERE "consumedAt" < now() - interval '7 days'
  LIMIT 10000
)
DELETE FROM "ProcessManagerInbox" i USING batch WHERE i.ctid = batch.ctid;
```

Repeat until it reports 0 rows deleted.

### 4. Reclaim

```sql
VACUUM (VERBOSE, ANALYZE) "ProcessManagerOutbox";
VACUUM (VERBOSE, ANALYZE) "ProcessManagerInbox";
```

**Do not run `VACUUM FULL`.** It takes an ACCESS EXCLUSIVE lock for the whole
rewrite, which blocks every reader and writer of a table the automations
pipeline writes to continuously.

### 5. Verify

Re-run the baseline query from step 1.

Expect the row counts to drop to roughly one day of traffic and the reported
**file sizes to stay the same**. That is the intended outcome, not a failed
purge: a plain `VACUUM` marks pages reusable rather than returning them to the
filesystem, so Postgres refills them with new rows instead of extending the
files. The goal is for growth to stop, not for the numbers to shrink.

To confirm the space really is reusable rather than merely still allocated:

```sql
SELECT relname, n_dead_tup, n_live_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('ProcessManagerOutbox', 'ProcessManagerInbox');
```

`n_dead_tup` should be near zero after the vacuum.

## After the deploy

The `processRetentionSweep` process manager takes over on an hourly schedule and
holds the tables at their steady state: dispatched outbox rows older than 24
hours, dead outbox rows older than 30 days, consumed inbox rows older than 7
days. Watch these for the first 48 hours:

- `process_manager_retention_swept_rows_total{table}` climbing every hour.
- Row counts for both tables flat, rather than resuming their previous slope.
- The oldest **pending** outbox row's age unchanged. The sweep must never touch
  pending work; if that age starts climbing, the sweep is deleting rows it
  should not.
- Zero increase in `duplicateEvent` commit outcomes, which is what deleting an
  inbox marker too early would look like.
