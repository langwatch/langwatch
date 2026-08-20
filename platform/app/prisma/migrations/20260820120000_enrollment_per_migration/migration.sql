-- Enrollment paces per (organization, migration) instead of per stage.
-- The legacy vocabulary maps onto migration names: "cutover" was exactly the
-- cutover migration, and "migrations" covered both preparation migrations,
-- so each such row becomes two.
ALTER TABLE "SystemMigrationEnrollment" RENAME COLUMN "stage" TO "migrationName";

-- Keep the index name in step with the column, matching what Prisma expects.
ALTER INDEX "SystemMigrationEnrollment_stage_idx" RENAME TO "SystemMigrationEnrollment_migrationName_idx";

UPDATE "SystemMigrationEnrollment"
SET "migrationName" = 'authz-grants-cutover'
WHERE "migrationName" = 'cutover';

INSERT INTO "SystemMigrationEnrollment" ("organizationId", "migrationName", "enrolledByUserId", "createdAt")
SELECT "organizationId", 'authz-grants-genesis-import', "enrolledByUserId", "createdAt"
FROM "SystemMigrationEnrollment"
WHERE "migrationName" = 'migrations'
ON CONFLICT DO NOTHING;

UPDATE "SystemMigrationEnrollment"
SET "migrationName" = 'authz-team-user-backfill'
WHERE "migrationName" = 'migrations';
