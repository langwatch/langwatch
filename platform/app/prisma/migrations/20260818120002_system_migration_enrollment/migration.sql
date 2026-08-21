-- Which organizations the in-place system migrations runner processes on
-- cloud (specs/migration/authz-grants-rollout.feature): one row per
-- (organization, stage), written from the ops migrations page. "migrations"
-- enrolls an organization for the preparation work (the team-user backfill
-- and the genesis import); "cutover" enrolls it for the flip onto the
-- engine. Self-hosted installations never read this table - their pacing is
-- the per-migration release declaration in code.
--
-- To roll back, uncomment and run manually. Dropping the table withdraws
-- every cloud organization from the rollout: the next pass processes
-- nothing new (organizations already migrated keep their state in
-- SystemMigrationTenantState), and operators re-enroll from the ops page.
-- DROP TABLE "SystemMigrationEnrollment";

-- CreateTable
CREATE TABLE "SystemMigrationEnrollment" (
    "organizationId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "enrolledByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemMigrationEnrollment_pkey" PRIMARY KEY ("organizationId","stage")
);

-- CreateIndex
CREATE INDEX "SystemMigrationEnrollment_stage_idx" ON "SystemMigrationEnrollment"("stage");
