-- ADR-046: the Langy conversation spine moved off Postgres onto the
-- event-sourcing framework. The conversation is now a projection of an event
-- stream — its spine lives in the ClickHouse `langy_conversations` fold table
-- and its messages in `langy_messages`. Drop the Postgres model.
--
-- Langy is staff-only and not rolled out, so there is no production data to
-- preserve (greenfield). relationMode = "prisma" means no SQL FK constraints
-- were emitted, so dropping the table is sufficient; its indexes drop with it.
-- The `LangyMessage` Postgres table was already removed in
-- 20260630000000_move_langy_messages_to_clickhouse.

DROP TABLE IF EXISTS "LangyConversation";
