-- Third of five (see 20260907120000_trigger_sent_latest_fire_index).
-- Every read that looks rows up by triggerId also has the projectId
-- (served by the new "TriggerSent_projectId_triggerId_createdAt_idx") or
-- the traceId (served by the "TriggerSent_triggerId_traceId_key" unique,
-- which stays). Nothing is left for a single-column triggerId index to do.
--
-- `CONCURRENTLY` so the drop never queues reads and writes behind it; the
-- index is gone once every transaction that could see it has finished.
-- `IF EXISTS` so a re-run after a partial deploy is a no-op.
DROP INDEX CONCURRENTLY IF EXISTS "TriggerSent_triggerId_idx";

-- Down step. To roll back, uncomment and run manually.
-- CREATE INDEX CONCURRENTLY "TriggerSent_triggerId_idx" ON "TriggerSent"("triggerId");
