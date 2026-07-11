-- Atomic open-incident claim for graph alerts. `openIncidentKey` holds the
-- identity of the incident this row represents while it is firing, and is
-- cleared (NULL) on resolve. The single-column unique means at most one OPEN
-- incident can exist per identity — Postgres treats NULLs as distinct, so any
-- number of resolved rows coexist. `@@unique([triggerId, traceId])` cannot
-- guard graph alerts because their `traceId` is NULL.
ALTER TABLE "TriggerSent" ADD COLUMN "openIncidentKey" TEXT;

CREATE UNIQUE INDEX "TriggerSent_openIncidentKey_key" ON "TriggerSent"("openIncidentKey");
