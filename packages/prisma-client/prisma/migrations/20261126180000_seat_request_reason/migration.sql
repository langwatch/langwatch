-- IRREVERSIBLE: adds the nullable SeatRequest."reason" column.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- What a Lite Member who pressed Request access was trying to do (modules/organization/specs/seat-requests.feature).
-- A nullable column with no default is a catalogue-only change: no rewrite, no long lock.
ALTER TABLE "SeatRequest" ADD COLUMN IF NOT EXISTS "reason" TEXT;
