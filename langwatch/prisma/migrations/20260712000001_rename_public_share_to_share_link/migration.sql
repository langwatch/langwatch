-- Rename PublicShare -> ShareLink and move authorization onto a secret token.
-- See ADR-039 (dev/docs/adr/039-token-gated-trace-sharing.md).
--
-- Legacy /share/<id> URLs keep working: `token` is backfilled from the old `id`
-- (a 21-char nanoid, ~126 bits of entropy), `visibility` defaults to PUBLIC and
-- `expiresAt` stays NULL, so every pre-migration link resolves unchanged.
--
-- relationMode = "prisma" so there are no SQL foreign keys to juggle.

-- Rename the resource-type enum (dependent columns follow the rename).
ALTER TYPE "PublicShareResourceTypes" RENAME TO "ShareResourceType";

-- New audience enum.
CREATE TYPE "ShareVisibility" AS ENUM ('PUBLIC', 'ORGANIZATION', 'PROJECT');

-- Rename the table and its index/constraint objects to the names Prisma expects.
ALTER TABLE "PublicShare" RENAME TO "ShareLink";
ALTER INDEX "PublicShare_pkey" RENAME TO "ShareLink_pkey";
ALTER INDEX "PublicShare_userId_idx" RENAME TO "ShareLink_userId_idx";

-- Drop the one-share-per-resource constraint: a trace may now carry several
-- links with different audiences / expiries.
DROP INDEX "PublicShare_projectId_resourceType_resourceId_key";

-- New columns.
ALTER TABLE "ShareLink" ADD COLUMN "token" TEXT;
ALTER TABLE "ShareLink" ADD COLUMN "threadId" TEXT;
ALTER TABLE "ShareLink" ADD COLUMN "visibility" "ShareVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "ShareLink" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "ShareLink" ADD COLUMN "maxViews" INTEGER;
ALTER TABLE "ShareLink" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill token from the existing id so pre-migration links keep resolving.
UPDATE "ShareLink" SET "token" = "id" WHERE "token" IS NULL;

-- Enforce token presence + uniqueness now that every row has one.
ALTER TABLE "ShareLink" ALTER COLUMN "token" SET NOT NULL;
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- Resource lookups are now non-unique.
CREATE INDEX "ShareLink_projectId_resourceType_resourceId_idx" ON "ShareLink"("projectId", "resourceType", "resourceId");

-- IRREVERSIBLE: This migration allows multiple ShareLink rows for a single
-- resource (by dropping the unique constraint on (projectId, resourceType, resourceId)).
-- Once this is used in production, the rollback cannot be safely automated because
-- recreating the unique PublicShare_projectId_resourceType_resourceId_key index
-- would fail on duplicate rows. Manual rollback would require first collapsing
-- or deleting duplicate links before recreating the constraint.
--
-- Manual rollback steps (not safe for production after multiple links exist):
-- DROP INDEX "ShareLink_projectId_resourceType_resourceId_idx";
-- DROP INDEX "ShareLink_token_key";
-- ALTER TABLE "ShareLink" DROP COLUMN "viewCount";
-- ALTER TABLE "ShareLink" DROP COLUMN "maxViews";
-- ALTER TABLE "ShareLink" DROP COLUMN "expiresAt";
-- ALTER TABLE "ShareLink" DROP COLUMN "visibility";
-- ALTER TABLE "ShareLink" DROP COLUMN "threadId";
-- ALTER TABLE "ShareLink" DROP COLUMN "token";
-- CREATE UNIQUE INDEX "PublicShare_projectId_resourceType_resourceId_key" ON "ShareLink"("projectId", "resourceType", "resourceId");
-- ALTER INDEX "ShareLink_userId_idx" RENAME TO "PublicShare_userId_idx";
-- ALTER INDEX "ShareLink_pkey" RENAME TO "PublicShare_pkey";
-- ALTER TABLE "ShareLink" RENAME TO "PublicShare";
-- DROP TYPE "ShareVisibility";
-- ALTER TYPE "ShareResourceType" RENAME TO "PublicShareResourceTypes";
