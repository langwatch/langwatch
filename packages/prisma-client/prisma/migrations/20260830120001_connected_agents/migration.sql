-- Connected agents (ADR-128).
--
-- An agent of type "connected" is registered by the SDK from the process that
-- runs it. One row exists per project, name, environment and scope, and the
-- SDK upserts it by "identityKey". "lastSeenAt" is the presence projection a
-- daily sweep reads to archive agents unseen for thirty days.
--
-- IRREVERSIBLE: there is no down migration.
--
-- The schema part reverses with the statements below, run by hand:
--
--   DROP INDEX "Agent_projectId_lastSeenAt_idx";
--   DROP INDEX "Agent_projectId_identityKey_key";
--   ALTER TABLE "Agent" DROP COLUMN "lastSeenAt";
--   ALTER TABLE "Agent" DROP COLUMN "identityKey";
--   ALTER TABLE "Agent" DROP COLUMN "hostLabel";
--   ALTER TABLE "Agent" DROP COLUMN "ownerUserId";
--   ALTER TABLE "Agent" DROP COLUMN "environment";
--
-- The data part does not. "identityKey" is what the SDK upserts a connected
-- agent by, so dropping it detaches every registered process from its row, and
-- a second registration then writes a duplicate. "lastSeenAt" is the only
-- record of presence, so the archive sweep loses its input. Both come back
-- only after every connected process reconnects, which is why this is a data
-- decision and not a schema one.

ALTER TABLE "Agent" ADD COLUMN "environment" TEXT;
ALTER TABLE "Agent" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "hostLabel" TEXT;
ALTER TABLE "Agent" ADD COLUMN "identityKey" TEXT;
ALTER TABLE "Agent" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Agent_projectId_identityKey_key" ON "Agent"("projectId", "identityKey");
CREATE INDEX "Agent_projectId_lastSeenAt_idx" ON "Agent"("projectId", "lastSeenAt");
