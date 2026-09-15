-- Renames the per-project LangWatchQL tenant secret from "governedSqlKey" to
-- "lwqlKey", part of the governed-sql -> LWQL vocabulary rename.
--
-- This DROPS and RECREATES rather than ALTER ... RENAME COLUMN. The column
-- ships behind the release_lwql_workbench flag, which is false in every
-- environment, so no project has ever presented its key to a running executor
-- and there is no value worth preserving. Recreating mints a fresh secret per
-- project from the volatile default, which is the safer of the two: a rename
-- would carry forward keys that were minted under the old vocabulary.
--
-- Deploy order: this migration and the code that reads "lwqlKey" ship in the
-- same release. Prisma enumerates every Project column on ordinary project
-- fetches, so a pod running the previous image against this schema raises
-- 42703 application-wide rather than only on the LangWatchQL surface. Do not
-- run this migration ahead of the deploy.
ALTER TABLE "Project" DROP COLUMN "governedSqlKey";

ALTER TABLE "Project" ADD COLUMN "lwqlKey" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;

-- CreateIndex
CREATE UNIQUE INDEX "Project_lwqlKey_key" ON "Project"("lwqlKey");

-- Down (manually executable rollback — uncomment and run manually; Prisma does
-- not run down migrations. Dropping the column discards every project's minted
-- LangWatchQL tenant secret; the re-added column mints new ones.)
-- DROP INDEX "Project_lwqlKey_key";
-- ALTER TABLE "Project" DROP COLUMN "lwqlKey";
-- ALTER TABLE "Project" ADD COLUMN "governedSqlKey" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;
-- CREATE UNIQUE INDEX "Project_governedSqlKey_key" ON "Project"("governedSqlKey");
