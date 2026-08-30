-- Connected agents (ADR-128).
--
-- An agent of type "connected" is registered by the SDK from the process that
-- runs it. One row exists per project, name, environment and scope, and the
-- SDK upserts it by "identityKey". "lastSeenAt" is the presence projection a
-- daily sweep reads to archive agents unseen for thirty days.

ALTER TABLE "Agent" ADD COLUMN "environment" TEXT;
ALTER TABLE "Agent" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "hostLabel" TEXT;
ALTER TABLE "Agent" ADD COLUMN "identityKey" TEXT;
ALTER TABLE "Agent" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Agent_projectId_identityKey_key" ON "Agent"("projectId", "identityKey");
CREATE INDEX "Agent_projectId_lastSeenAt_idx" ON "Agent"("projectId", "lastSeenAt");
