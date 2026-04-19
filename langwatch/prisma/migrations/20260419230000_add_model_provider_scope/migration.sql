-- Principal-scoped ModelProvider (rchaves iter 107 #2).
--
-- Background: ModelProvider rows were project-scoped only. Enterprise
-- customers want to configure a provider credential once at the
-- organization or team level and have every project under that scope
-- inherit it automatically. Mirrors the RoleBinding principal pattern
-- so access-control reasoning stays uniform.
--
-- Strategy:
--   1. Add scopeType + scopeId columns (nullable at first so the
--      backfill can populate without a schema-dance).
--   2. Backfill every existing row as scopeType='PROJECT',
--      scopeId=projectId. Zero behavior change — the new resolver
--      still finds the same rows for the same projects.
--   3. Mark the columns NOT NULL after backfill. The projectId
--      column stays as a legacy pointer; callers migrate off it
--      incrementally, then a v1.1 migration can drop it.
--
-- Rollback: drop both columns. No data loss on the PROJECT path;
-- ORG/TEAM rows can't be rolled back cleanly once callers start
-- creating them, but this migration itself is safe to revert.

ALTER TABLE "ModelProvider"
  ADD COLUMN "scopeType" TEXT,
  ADD COLUMN "scopeId"   TEXT;

UPDATE "ModelProvider"
SET "scopeType" = 'PROJECT',
    "scopeId"   = "projectId"
WHERE "scopeType" IS NULL;

ALTER TABLE "ModelProvider"
  ALTER COLUMN "scopeType" SET NOT NULL,
  ALTER COLUMN "scopeId"   SET NOT NULL;

CREATE INDEX "ModelProvider_scopeType_scopeId_idx"
  ON "ModelProvider" ("scopeType", "scopeId");
