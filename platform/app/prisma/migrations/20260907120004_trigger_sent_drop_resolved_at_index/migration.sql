-- Fifth of five (see 20260907120000_trigger_sent_latest_fire_index).
-- Every read that filters on resolvedAt also filters on customGraphId,
-- which keeps its own index; production shows this one was never scanned.
DROP INDEX CONCURRENTLY IF EXISTS "TriggerSent_resolvedAt_idx";

-- Down step. To roll back, uncomment and run manually.
-- CREATE INDEX CONCURRENTLY "TriggerSent_resolvedAt_idx" ON "TriggerSent"("resolvedAt");
