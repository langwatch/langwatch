-- ADR-039 phase 2. Entry-transit measurement runs once per UTC day (the
-- boundary calendar is day-grained), while the sweep itself is hourly. This
-- column is the durable "entries already measured for day D" cursor on the
-- platform-singleton sweep row; missed days self-heal because entry deltas
-- are cumulative-minus-prior.

-- AlterTable
ALTER TABLE "StorageSweepCursor" ADD COLUMN "lastEntrySweptDay" TIMESTAMP(3);

-- Down (commented out; to roll back, run manually):
-- ALTER TABLE "StorageSweepCursor" DROP COLUMN "lastEntrySweptDay";
