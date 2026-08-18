-- Backs the fire-history keyset walk (trigger-fire-history.prisma.repository):
-- WHERE "projectId" = ? AND "triggerId" = ? (plus the cursor predicate)
-- ORDER BY "createdAt" DESC, "id" DESC — a backward scan over this index.
--
-- LOCKING NOTE: plain `CREATE INDEX` takes a SHARE lock on "TriggerSent" —
-- reads keep working, fire writes block until the build finishes. The table
-- holds one row per delivered fire, so the build is a brief single heap read
-- during deploy. `CREATE INDEX CONCURRENTLY` would avoid the pause but cannot
-- run inside a transaction, which the Prisma migration setup requires.
CREATE INDEX "TriggerSent_projectId_triggerId_createdAt_id_idx" ON "TriggerSent"("projectId", "triggerId", "createdAt", "id");

-- To roll back, uncomment and run manually:
-- DROP INDEX "TriggerSent_projectId_triggerId_createdAt_id_idx";
