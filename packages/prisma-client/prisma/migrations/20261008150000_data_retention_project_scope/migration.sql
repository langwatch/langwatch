-- Data retention's own copy of where each project sits, owned by data-retention: a peer fold
-- over project's lifecycle facts (ARCHITECTURE §9; Alex, 2026-10-06, Q151 Q1), so retention
-- stops asking project for a project's team and organization. One row per project.
--
-- Expand only: a new table nobody else reads or writes. No foreign key: the rows are rebuilt
-- from project's event log by a projection replay of the lane
-- `data_retention_project_scope.projectScope`, which is also how existing projects arrive.
--
-- Spec: modules/data-retention/specs/data-retention-project-scope.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "DataRetentionProjectScope";

CREATE TABLE IF NOT EXISTS "DataRetentionProjectScope" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT,
    "teamRecordedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataRetentionProjectScope_pkey" PRIMARY KEY ("projectId")
);

CREATE INDEX IF NOT EXISTS "DataRetentionProjectScope_organizationId_idx"
    ON "DataRetentionProjectScope"("organizationId");

CREATE INDEX IF NOT EXISTS "DataRetentionProjectScope_teamId_idx"
    ON "DataRetentionProjectScope"("teamId");
