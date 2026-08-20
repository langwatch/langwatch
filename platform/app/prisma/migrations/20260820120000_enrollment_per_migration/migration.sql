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

-- IRREVERSIBLE: the forward direction splits one legacy "migrations" row into
-- two per-migration rows, and nothing records which organizations arrived that
-- way. Going back collapses them again, so an organization enrolled for only
-- ONE preparation migration (which the new model allows and the old one could
-- not express) would silently become enrolled for both. The rollback also
-- drops any enrollment written after this migration for a name outside the
-- legacy vocabulary.
--
-- To roll back, uncomment and run manually, accepting that loss:
--
--   UPDATE "SystemMigrationEnrollment"
--   SET "migrationName" = 'cutover'
--   WHERE "migrationName" = 'authz-grants-cutover';
--
--   DELETE FROM "SystemMigrationEnrollment"
--   WHERE "migrationName" = 'authz-grants-genesis-import';
--
--   UPDATE "SystemMigrationEnrollment"
--   SET "migrationName" = 'migrations'
--   WHERE "migrationName" = 'authz-team-user-backfill';
--
--   ALTER INDEX "SystemMigrationEnrollment_migrationName_idx" RENAME TO "SystemMigrationEnrollment_stage_idx";
--   ALTER TABLE "SystemMigrationEnrollment" RENAME COLUMN "migrationName" TO "stage";
