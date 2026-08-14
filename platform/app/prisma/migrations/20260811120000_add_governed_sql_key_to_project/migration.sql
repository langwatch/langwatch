-- Adds the per-project governed SQL tenant secret. The volatile default makes
-- PostgreSQL evaluate gen_random_uuid() once per existing row, so the backfill
-- mints a distinct random value for every project in the same statement.
ALTER TABLE "Project" ADD COLUMN "governedSqlKey" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;

-- CreateIndex
CREATE UNIQUE INDEX "Project_governedSqlKey_key" ON "Project"("governedSqlKey");

-- Down (manually executable rollback — uncomment and run manually; Prisma does
-- not run down migrations. Dropping the column discards every project's minted
-- governed SQL tenant secret; re-running this migration mints new ones.)
-- DROP INDEX "Project_governedSqlKey_key";
-- ALTER TABLE "Project" DROP COLUMN "governedSqlKey";
