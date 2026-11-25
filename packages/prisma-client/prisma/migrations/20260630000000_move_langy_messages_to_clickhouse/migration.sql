-- Move Langy message content to ClickHouse (PR #4913 follow-up).
--
-- Rogerio's design note: message content must live on the customer side
-- (ClickHouse) so hybrid-deployment customers' conversations never touch
-- LangWatch infrastructure. LangyMessage (Postgres) is replaced by the
-- langy_messages ClickHouse table (see migration 00034_create_langy_messages.sql).
--
-- The corresponding ClickHouse migration creates langy_messages.
-- Existing LangyMessage rows are discarded — this feature is staff-only
-- (release_langy_enabled defaults false) so there is no production data.

-- Add the two derived display/sort columns to the spine table.
ALTER TABLE "LangyConversation"
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: seed lastActivityAt from the existing updatedAt so the list
-- sort order is preserved for any existing (dev/staff) conversations.
UPDATE "LangyConversation" SET "lastActivityAt" = "updatedAt";

-- New indexes on lastActivityAt replacing the old updatedAt-based ones.
CREATE INDEX "LangyConversation_projectId_userId_lastActivityAt_idx"
  ON "LangyConversation"("projectId", "userId", "lastActivityAt");

CREATE INDEX "LangyConversation_projectId_isShared_lastActivityAt_idx"
  ON "LangyConversation"("projectId", "isShared", "lastActivityAt");

-- Drop the old updatedAt-based indexes (replaced above).
DROP INDEX IF EXISTS "LangyConversation_projectId_userId_updatedAt_idx";
DROP INDEX IF EXISTS "LangyConversation_projectId_isShared_updatedAt_idx";

-- Drop the message content table. Content migrates to ClickHouse.
DROP TABLE IF EXISTS "LangyMessage";
