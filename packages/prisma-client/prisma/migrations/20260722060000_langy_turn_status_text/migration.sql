-- AlterTable
-- `status` on the turn projection becomes TEXT and the enum type is dropped.
--
-- This column is part of a PROJECTION: one writer (the conversation-turn fold),
-- rebuildable from the durable event log, and nothing indexes or filters on it.
-- The enum therefore bought no query selectivity — only protection against a
-- typo the fold's own types already prevent — while charging a migration for
-- every new status. Postgres cannot remove an enum value, so each one was also
-- permanent. ADR-058's `stopped` was the status that made that cost visible.
--
-- The single definition now lives in `LANGY_CONVERSATION_TURN_STATUS` and is
-- enforced at the repository boundary.
--
-- Widening only: every existing value is a valid string, so this cannot fail on
-- existing rows and needs no backfill.
ALTER TABLE "LangyConversationTurnProjection"
  ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;

DROP TYPE "LangyProjectionTurnStatus";
