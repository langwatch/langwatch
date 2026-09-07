-- Fire history is read one way: the newest rows for one trigger, or the
-- newest rows for one project. The health probe (`/api/health/triggers`)
-- asks "when did this trigger last fire" with
-- `WHERE "triggerId" = $1 AND "projectId" = $2 ORDER BY "createdAt" DESC LIMIT 1`.
--
-- Every index on "TriggerSent" led with a column that could find the rows
-- but not order them: single-column triggerId, single-column projectId. One
-- trigger holds 65% of the table in production, so for it "find the rows"
-- is "find the table", and the planner correctly gave up on both indexes
-- and sequentially scanned every row to sort out the newest one. Measured
-- on production: 710 ms per probe on a warm cache, a mean of 1.1 s and a
-- worst case of 171 s across six months of calls, eighth most expensive
-- query in the database by total time - for an endpoint that returns one
-- row and is polled by an external monitor.
--
-- A composite ending in createdAt lets the planner walk to the newest
-- entry directly: an Index Scan Backward that reads a handful of pages no
-- matter how many rows the trigger has. The project-scoped twin serves the
-- automations activity feed (`findAllRecentForProject`), which has the same
-- shape without the triggerId.
--
-- The single-column triggerId and projectId indexes are prefixes of the new
-- composites and go. So does the index on resolvedAt: every read that
-- filters on it also filters on customGraphId, which keeps its own index,
-- and production shows the resolvedAt index has never been scanned once.
-- Any lookup by triggerId alone is still served by the
-- "TriggerSent_triggerId_traceId_key" unique.
--
-- LOCKING NOTE: plain `CREATE INDEX` takes a SHARE lock on "TriggerSent" -
-- reads keep working, writes wait until the build finishes. Writes to this
-- table are the automations firing: each one queues behind the build and
-- lands when it lifts, none is lost. The two builds run back to back, so
-- plan for the sum. `CREATE INDEX CONCURRENTLY` would avoid the wait but
-- cannot run inside the transaction Prisma wraps a migration in - the same
-- trade 20260804120000_dataset_record_project_dataset_index made.
--
-- Measured on a local Postgres 16 on developer hardware, over a 2.1M-row
-- reproduction of the production distribution (one project/trigger pair
-- holding 1.385M rows, the rest spread over 229 pairs): 3.0 s and 97 MB for
-- the three-column index, 1.8 s and 76 MB for the two-column one. The probe
-- went from a 68 ms parallel sequential scan to a 0.013 ms index scan on
-- the same data. Read the build times as an order of magnitude: expect
-- roughly ten seconds against production, not five.
--
-- ORDERING NOTE: the creates come before the drops on purpose. `prisma
-- migrate diff` emits the drops first; in that order the ACCESS EXCLUSIVE
-- lock the drops take is held through the whole build above, and reads
-- block for those ten seconds too, not just writes. Keep this order if the
-- file is ever regenerated.
CREATE INDEX "TriggerSent_projectId_triggerId_createdAt_idx" ON "TriggerSent"("projectId", "triggerId", "createdAt");
CREATE INDEX "TriggerSent_projectId_createdAt_idx" ON "TriggerSent"("projectId", "createdAt");

-- Dropping takes an ACCESS EXCLUSIVE lock for the time it takes to unlink a
-- catalog entry: 1-21 ms each on the reproduction above.
DROP INDEX "TriggerSent_triggerId_idx";
DROP INDEX "TriggerSent_projectId_idx";
DROP INDEX "TriggerSent_resolvedAt_idx";

-- Down (manual rollback; uncomment and run). Indexes carry no row data, so
-- nothing is lost either way - the probe just goes back to scanning every
-- row the trigger ever wrote.
-- CREATE INDEX "TriggerSent_triggerId_idx" ON "TriggerSent"("triggerId");
-- CREATE INDEX "TriggerSent_projectId_idx" ON "TriggerSent"("projectId");
-- CREATE INDEX "TriggerSent_resolvedAt_idx" ON "TriggerSent"("resolvedAt");
-- DROP INDEX "TriggerSent_projectId_triggerId_createdAt_idx";
-- DROP INDEX "TriggerSent_projectId_createdAt_idx";
