-- IRREVERSIBLE: creates the "LangyPullRequest" table.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- One row per pull request Langy opened: finished checks look it up by repository and number to
-- wake the conversation, and the daily pull request cap counts a person's rows by day
-- (modules/langy/specs/langy-ci-follow-up.feature). Expand only; rebuilt by a projection replay.
CREATE TABLE IF NOT EXISTS "LangyPullRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openedAt" DOUBLE PRECISION NOT NULL,
    "sourceEventId" TEXT NOT NULL,

    CONSTRAINT "LangyPullRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LangyPullRequest_repositoryFullName_prNumber_key"
  ON "LangyPullRequest"("repositoryFullName", "prNumber");

CREATE INDEX IF NOT EXISTS "LangyPullRequest_userId_openedAt_idx"
  ON "LangyPullRequest"("userId", "openedAt");

-- The conversation's CI follow-ups since the person last wrote. A constant default adds no
-- rewrite; rows folded before it existed had no follow-ups, so 0 is their true count.
ALTER TABLE "LangyConversationProjection"
  ADD COLUMN IF NOT EXISTS "ciFollowUpsInARow" INTEGER NOT NULL DEFAULT 0;
