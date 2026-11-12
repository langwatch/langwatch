-- IRREVERSIBLE: creates the "LangyConversationPullRequestsProjection" table.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- Langy's fold of the pull requests each conversation opened and its CI follow-ups in a row,
-- which finished checks look up to wake the conversation (modules/langy/specs/langy-ci-follow-up.feature).
-- Expand only: a new table nobody else reads or writes. Rebuilt by a projection replay.
CREATE TABLE IF NOT EXISTS "LangyConversationPullRequestsProjection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "pullRequestKeys" TEXT[],
    "pullRequests" JSONB NOT NULL,
    "followUpsInARow" INTEGER NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    "occurredAt" DOUBLE PRECISION NOT NULL,
    "acceptedAt" DOUBLE PRECISION NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "projectionVersion" TEXT NOT NULL,

    CONSTRAINT "LangyConversationPullRequestsProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LangyConversationPullRequests_projectId_conversationId_key"
  ON "LangyConversationPullRequestsProjection"("projectId", "conversationId");

CREATE INDEX IF NOT EXISTS "LangyConversationPullRequests_pullRequestKeys_idx"
  ON "LangyConversationPullRequestsProjection" USING GIN ("pullRequestKeys");
