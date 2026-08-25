-- Deleting a group MARKS it, so its history survives the deletion.
--
-- The previous migration (20260825130000_group_membership_is_event_truth) made
-- a membership removal mark its row instead of deleting it, so that "who could
-- reach this in June" stays answerable. It then had to state a limit it could
-- not close: `GroupMembership.group` cascaded, so deleting the GROUP erased
-- every one of those marked rows. The ledger kept the facts; the projection
-- lost exactly the history the change existed to preserve. This closes it.
--
-- Four changes, in the order they have to happen:
--
--   1. `deletedAt` / `deletedReason` - the mark, the same pair `Grant`,
--      `Role` and now `GroupMembership` carry. NULL is live, which is what
--      every existing row is, so there is no data movement.
--   2. Both full uniques become PARTIAL uniques over live rows. A group that
--      was deleted and re-created under the same slug, and a SCIM directory
--      group that disappears and comes back with the same externalId, are
--      both ordinary and both refused by a full unique. Prisma cannot declare
--      a partial index, so neither is in schema.prisma - the same convention
--      RoleBinding's six partial uniques and the membership live-key already
--      follow. Declaring them there would make the next `prisma migrate dev`
--      drop the WHERE clause and rebuild them across every deleted row, which
--      is the one thing the clause is for.
--   3. An index on ("organizationId","deletedAt"), because every group listing
--      in the product now filters on the pair.
--
-- NOT here, and deliberately: the cascade change. This datasource is
-- `relationMode = "prisma"`, so there are no foreign keys in this database at
-- all - `onDelete` is emulated by the Prisma client on the calls it makes.
-- `GroupMembership.group` moving from Cascade to Restrict is therefore a
-- schema.prisma change with no DDL behind it, and it takes effect the moment
-- the client is regenerated. What it does is turn a `group.delete()` that
-- would silently erase an audit trail into a loud client-side refusal.
-- `deleteProvisionedOrganization` deletes the memberships explicitly for that
-- reason. `RoleBinding.group` deliberately KEEPS its cascade: RoleBinding is
-- the compat head, not a record - a revoke deletes it, and a binding's history
-- lives on the `Grant` row and the events behind it, neither of which relates
-- to "Group" at all.
--
-- BACKFILL, honestly: every surviving row is a LIVE group, so `deletedAt`
-- stays NULL and nothing moves. Groups deleted BEFORE this migration are
-- unrecoverable - the rows were deleted, and so were the memberships that
-- cascaded with them. This migration cannot invent them and does not pretend
-- to. History starts here.
--
-- To roll back, uncomment and run manually. Dropping `deletedAt` turns every
-- deleted group back into a live one, which GRANTS access that was
-- deliberately removed - so a rollback must delete the marked rows first, and
-- their memberships with them, since the restored full uniques would also
-- collide on any name that was re-used after a deletion.
-- DELETE FROM "GroupMembership" WHERE "groupId" IN (SELECT "id" FROM "Group" WHERE "deletedAt" IS NOT NULL);
-- DELETE FROM "Group" WHERE "deletedAt" IS NOT NULL;
-- DROP INDEX IF EXISTS "Group_organizationId_slug_live_key";
-- DROP INDEX IF EXISTS "Group_organizationId_externalId_live_key";
-- DROP INDEX IF EXISTS "Group_organizationId_deletedAt_idx";
-- ALTER TABLE "Group" DROP COLUMN "deletedReason";
-- ALTER TABLE "Group" DROP COLUMN "deletedAt";
-- CREATE UNIQUE INDEX "Group_organizationId_slug_key" ON "Group"("organizationId", "slug");
-- CREATE UNIQUE INDEX "Group_organizationId_externalId_key" ON "Group"("organizationId", "externalId");

-- AlterTable
ALTER TABLE "Group" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Group" ADD COLUMN "deletedReason" TEXT;

-- DropIndex
-- The full uniques go, and come back below carrying `WHERE "deletedAt" IS
-- NULL`. Two LIVE groups sharing a slug is the state that stays refused; any
-- number of DELETED ones sharing it is ordinary history.
DROP INDEX IF EXISTS "Group_organizationId_slug_key";

DROP INDEX IF EXISTS "Group_organizationId_externalId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Group_organizationId_slug_live_key"
  ON "Group"("organizationId", "slug")
  WHERE "deletedAt" IS NULL;

-- CreateIndex
-- The SCIM half of the same rule. A directory group that is removed and
-- pushed back keeps its externalId, and a full unique would refuse the second
-- arrival outright.
CREATE UNIQUE INDEX "Group_organizationId_externalId_live_key"
  ON "Group"("organizationId", "externalId")
  WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "Group_organizationId_deletedAt_idx" ON "Group"("organizationId", "deletedAt");
