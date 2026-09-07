-- Fourth of five (see 20260907120000_trigger_sent_latest_fire_index).
-- projectId leads both new composites, so any lookup by project alone
-- (the stats rollup, the open-claims read) walks one of those instead.
DROP INDEX CONCURRENTLY IF EXISTS "TriggerSent_projectId_idx";

-- Down (manual rollback; uncomment and run):
-- CREATE INDEX CONCURRENTLY "TriggerSent_projectId_idx" ON "TriggerSent"("projectId");
