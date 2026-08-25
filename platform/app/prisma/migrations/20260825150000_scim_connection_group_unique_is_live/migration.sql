-- The connection-scoped SCIM unique becomes live-only, like the other two.
--
-- 20260825020006_scim_per_connection added
-- `Group_scimConnectionId_externalId_key` as a FULL unique, so that two
-- connections in one organization can each provision their own "engineering".
-- That was correct while a group deletion deleted the row.
--
-- 20260825140000_group_deletion_keeps_its_history changed that: a deleted
-- group is now MARKED, and its row survives so the memberships it held stay
-- readable. It converted `([organizationId, slug])` and
-- `([organizationId, externalId])` to partial uniques over live rows for
-- exactly that reason, but the connection-scoped index predates it on a
-- different branch and was left behind.
--
-- Left as a full unique it refuses the case the other two now allow: a
-- directory group removed and pushed back under the same connection keeps its
-- externalId, and the dead row would collide with the new one. The identity
-- provider would be unable to re-create a group it owns, with no way to see
-- why. Two LIVE groups sharing a connection's externalId stays refused; any
-- number of deleted ones sharing it is ordinary history.
--
-- No data moves: every surviving row is live, so the partial index covers the
-- same set the full one did.
--
-- To roll back, uncomment and run manually. Restoring the full unique
-- collides on any externalId re-used after a deletion, so the marked rows
-- have to go first, and the memberships they hold with them.
-- DELETE FROM "GroupMembership" WHERE "groupId" IN (SELECT "id" FROM "Group" WHERE "deletedAt" IS NOT NULL);
-- DELETE FROM "Group" WHERE "deletedAt" IS NOT NULL;
-- DROP INDEX IF EXISTS "Group_scimConnectionId_externalId_live_key";
-- CREATE UNIQUE INDEX "Group_scimConnectionId_externalId_key" ON "Group"("scimConnectionId", "externalId");

-- DropIndex
DROP INDEX IF EXISTS "Group_scimConnectionId_externalId_key";

-- CreateIndex
-- Postgres treats NULLs as distinct, so this constrains only the live groups
-- that carry both a connection and an externalId.
CREATE UNIQUE INDEX "Group_scimConnectionId_externalId_live_key"
  ON "Group"("scimConnectionId", "externalId")
  WHERE "deletedAt" IS NULL;
