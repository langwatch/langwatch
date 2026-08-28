-- ADR-128: puller health needs "when did a run last work", which neither
-- lastRunAt (moves on failures) nor lastEventAt (moves only when data
-- arrives) answers. Both columns are nullable and backfilled by the
-- projection replay the version bump forces, so no data migration here.

-- AlterTable
ALTER TABLE "IngestionSource" ADD COLUMN     "lastSuccessAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN     "lastSuccessAt" DOUBLE PRECISION;
