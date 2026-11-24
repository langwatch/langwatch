-- IRREVERSIBLE: adds the nullable SeatRequest."seatPendingSince" column.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- Set while an approval gives its seat, cleared once it is given (modules/organization/specs/seat-requests.feature).
-- A nullable column with no default is a catalogue-only change: no rewrite, no long lock.
ALTER TABLE "SeatRequest" ADD COLUMN IF NOT EXISTS "seatPendingSince" TIMESTAMP(3);
