-- Second of five (see 20260907120000_trigger_sent_latest_fire_index).
-- The project-scoped twin of the latest-fire index: the automations
-- activity feed (`findAllRecentForProject`) reads the newest rows for one
-- project, `WHERE "projectId" = $1 ORDER BY "createdAt" DESC LIMIT n`, and
-- had the same sequential-scan-and-sort plan (582 ms in production).
-- 1.8 s and 76 MB on the local reproduction.
--
-- Same failure recovery as the first file, with this index's name and
-- migration name.
CREATE INDEX CONCURRENTLY "TriggerSent_projectId_createdAt_idx" ON "TriggerSent"("projectId", "createdAt");

-- To roll back, uncomment and run manually.
-- DROP INDEX CONCURRENTLY "TriggerSent_projectId_createdAt_idx";
