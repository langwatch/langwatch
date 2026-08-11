-- Adds the per-project governed SQL tenant secret. The volatile default makes
-- PostgreSQL evaluate gen_random_uuid() once per existing row, so the backfill
-- mints a distinct random value for every project in the same statement.
ALTER TABLE "Project" ADD COLUMN "governedSqlKey" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;

-- CreateIndex
CREATE UNIQUE INDEX "Project_governedSqlKey_key" ON "Project"("governedSqlKey");
