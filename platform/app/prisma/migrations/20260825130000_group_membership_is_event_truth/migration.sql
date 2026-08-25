-- Group membership becomes event truth (ADR-125's named prerequisite).
--
-- The table was `PRIMARY KEY ("userId","groupId")` with a `createdAt` and
-- nothing else, and removal was a hard DELETE. Since COLLECT unions
-- {user} u groups, an access answer computed after a removal understated the
-- access that existed, and no table held the correction. `Grant` solved the
-- same problem years earlier by MARKING a revoked row instead of deleting it
-- ("it threw away the answer to when a grant ended and why"); this gives the
-- membership row the same posture.
--
-- Four changes, in the order they have to happen:
--
--   1. A surrogate `id`. The pair cannot stay the key once a membership can
--      end and be re-created: the same (userId, groupId) then names two
--      different memberships with two different lifetimes. Existing rows get
--      a generated id; the shape matches every other backfilled id in this
--      directory (`gen_random_uuid()::text`).
--   2. `occurredAt` - business time, and the projection's write guard. It is
--      backfilled from `createdAt`, which IS when those memberships began.
--   3. `removedAt` / `removedReason` - the mark. NULL is live, which is what
--      every existing row is, so there is no data movement.
--   4. The pair's uniqueness, re-expressed as a PARTIAL unique over live
--      rows. Prisma cannot declare a partial index, so this index is NOT in
--      schema.prisma - the same convention RoleBinding's six partial uniques
--      and the Grant principal index already follow. Declaring it there would
--      make the next `prisma migrate dev` drop the WHERE clause and rebuild
--      it across every removed row, which is the one thing the clause is for.
--
-- BACKFILL, honestly: every surviving row is a LIVE membership, so
-- `removedAt` stays NULL and nothing moves. Memberships removed BEFORE this
-- migration are unrecoverable - the rows were deleted and no event, audit row
-- or projection recorded them. This migration cannot invent them and does not
-- pretend to. History starts here.
--
-- To roll back, uncomment and run manually. Dropping `removedAt` turns every
-- ended membership back into a live one, which GRANTS access that was
-- deliberately removed - so a rollback must delete the marked rows first.
-- DELETE FROM "GroupMembership" WHERE "removedAt" IS NOT NULL;
-- DROP INDEX IF EXISTS "GroupMembership_userId_groupId_live_key";
-- DROP INDEX IF EXISTS "GroupMembership_userId_removedAt_idx";
-- DROP INDEX IF EXISTS "GroupMembership_groupId_removedAt_idx";
-- CREATE INDEX "GroupMembership_userId_idx" ON "GroupMembership"("userId");
-- CREATE INDEX "GroupMembership_groupId_idx" ON "GroupMembership"("groupId");
-- ALTER TABLE "GroupMembership" DROP COLUMN "removedReason";
-- ALTER TABLE "GroupMembership" DROP COLUMN "removedAt";
-- ALTER TABLE "GroupMembership" DROP COLUMN "occurredAt";
-- ALTER TABLE "GroupMembership" DROP CONSTRAINT "GroupMembership_pkey";
-- ALTER TABLE "GroupMembership" DROP COLUMN "id";
-- ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("userId","groupId");

-- AlterTable
ALTER TABLE "GroupMembership" ADD COLUMN "id" TEXT;

UPDATE "GroupMembership" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

ALTER TABLE "GroupMembership" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "GroupMembership" DROP CONSTRAINT "GroupMembership_pkey";

ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id");

ALTER TABLE "GroupMembership" ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "GroupMembership" SET "occurredAt" = "createdAt";

ALTER TABLE "GroupMembership" ADD COLUMN "removedAt" TIMESTAMP(3);

ALTER TABLE "GroupMembership" ADD COLUMN "removedReason" TEXT;

-- CreateIndex
CREATE INDEX "GroupMembership_userId_removedAt_idx" ON "GroupMembership"("userId", "removedAt");

-- CreateIndex
CREATE INDEX "GroupMembership_groupId_removedAt_idx" ON "GroupMembership"("groupId", "removedAt");

-- DropIndex
-- The two single-column indexes are now leading-column prefixes of the pair
-- above, and Postgres answers a `userId`-only lookup from
-- ("userId","removedAt") just as well. Keeping them would buy nothing and cost
-- two more index writes on every membership insert and every removal mark --
-- and removals are now writes rather than deletes, so that cost doubled the
-- moment this migration ran.
DROP INDEX IF EXISTS "GroupMembership_userId_idx";
DROP INDEX IF EXISTS "GroupMembership_groupId_idx";

-- CreateIndex
-- The pair's uniqueness, over live rows only. NOT declared in schema.prisma:
-- Prisma has no partial indexes, and an `@@unique` there would drop the WHERE
-- clause on the next `migrate dev`. Two live memberships for one pair is the
-- state this refuses; any number of ENDED ones is ordinary history.
CREATE UNIQUE INDEX "GroupMembership_userId_groupId_live_key"
  ON "GroupMembership"("userId", "groupId")
  WHERE "removedAt" IS NULL;
