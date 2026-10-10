-- Unified-trace branch correction (rchaves + master_orchestrator
-- directive 2026-04-27): governance ingestion folds into the existing
-- trace pipeline. This migration adds the two metadata columns the
-- receiver rewire (commit 2/3) and the retention TTL policy (commit
-- 3/3) need:
--
--   1. Project.kind — "application" (default) vs "internal_governance"
--      (hidden per-org routing/tenancy artifact for IngestionSource data).
--      Composite index (teamId, kind) makes the "filter governance
--      projects out of user-visible surfaces" check cheap.
--
--   2. IngestionSource.retentionClass — per-origin retention bucket
--      ("thirty_days" / "one_year" / "seven_years") applied to every
--      span/log emitted by the source's events.
--
-- Both columns default to the back-compatible value (existing projects
-- are "application"; existing ingestion sources are "thirty_days") so
-- the migration is a no-op for current data.

ALTER TABLE "Project" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'application';
CREATE INDEX "Project_teamId_kind_idx" ON "Project"("teamId", "kind");

ALTER TABLE "IngestionSource" ADD COLUMN "retentionClass" TEXT NOT NULL DEFAULT 'thirty_days';
