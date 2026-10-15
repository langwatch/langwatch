-- Board scope: Only me, Project, Organization (modules/dashboard/specs/dashboards-v2.feature,
-- AC170 to AC186). Additive only: the image still serving never names these columns, and every
-- row it writes takes the default, Project, which is the audience every board has today.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DashboardScope') THEN
    CREATE TYPE "DashboardScope" AS ENUM ('PRIVATE', 'PROJECT', 'ORGANIZATION');
  END IF;
END $$;

-- One statement, so the table's readers queue behind one lock wait and not two. "organizationId"
-- is the owning project's organization, stamped when a board is first set to Organization.
ALTER TABLE "Dashboard"
  ADD COLUMN IF NOT EXISTS "scope" "DashboardScope" NOT NULL DEFAULT 'PROJECT',
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- Listing a project's boards also reads the organization's shared ones by (organizationId, scope).
-- "Dashboard" is small next to the event tables, so this builds in well under the lock timeout. An
-- install that holds very many boards can build it ahead, outside Prisma's transaction; a failed
-- concurrent build leaves an INVALID index of this name (check pg_index.indisvalid, then
-- DROP INDEX CONCURRENTLY) that this statement would otherwise skip.
-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "Dashboard_organizationId_scope_idx" ON "Dashboard" ("organizationId", "scope");
CREATE INDEX IF NOT EXISTS "Dashboard_organizationId_scope_idx" ON "Dashboard" ("organizationId", "scope");

-- No row is changed here, and none needs it. "createdById" arrives with this release
-- (20261012210101), so no board made by an earlier image has an author, and a member's own
-- My dashboard made from this release on starts at Only me where Dashboards is on (AC170).
