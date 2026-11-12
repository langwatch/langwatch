-- An index on NurturingOrganizationCreated."createdAt" (nurturing's own table), for the hourly
-- sweep that ends each organization's trace counting window: it reads the organizations created
-- in an hour.
--
-- Expand only: an index nobody else reads. Nothing is altered or dropped.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP INDEX "NurturingOrganizationCreated_createdAt_idx";

-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "NurturingOrganizationCreated_createdAt_idx" ON "NurturingOrganizationCreated" ("createdAt");
-- (a failed concurrent build leaves an invalid index: check pg_index.indisvalid, DROP INDEX CONCURRENTLY, retry)
CREATE INDEX IF NOT EXISTS "NurturingOrganizationCreated_createdAt_idx" ON "NurturingOrganizationCreated" ("createdAt");
