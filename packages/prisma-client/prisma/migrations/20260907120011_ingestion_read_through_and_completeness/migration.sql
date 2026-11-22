-- How far a pull run actually read, and whether it reached the end.
--
-- Two places, on purpose. The projection row is written by the fold and is the
-- event-sourced truth. The IngestionSource row mirrors it for the screens,
-- exactly as lastSuccessAt is mirrored today: every reader of source health
-- selects from that row, and two of them render a list of sources, so reading
-- a per-run projection would be one query per row on a screen built to show
-- many sources at once.
--
-- The run's own clock is deliberately NOT stored. A stuck source's clock
-- advances on every failed attempt, so it would read as progress; only the
-- point the run REACHED can tell a source that truncated once from one that
-- is stuck.
--
-- All four nullable, so no replay is needed for this to be safe. Null
-- completeness means unknown, which is what every existing row holds, and
-- unknown must never render as either answer.

ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastReadThroughAt" DOUBLE PRECISION;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastRunCompleteness" TEXT;

ALTER TABLE "IngestionSource" ADD COLUMN "lastReadThroughAt" TIMESTAMP(3);
ALTER TABLE "IngestionSource" ADD COLUMN "lastRunCompleteness" TEXT;

-- Down
--
-- The up step is purely additive: four nullable columns across two tables, no
-- backfill, no constraint, no index. So the reversal is the drops below and
-- nothing else, and it loses only how far the last run read and whether it
-- reached the end.
--
-- Nothing is lost that cannot be rebuilt. The projection columns are folded
-- from the event log, so replaying it after a re-apply restores them, and the
-- two IngestionSource columns mirror that projection rather than holding
-- anything of their own. Until then source health reads "unknown", which is
-- exactly what every row held before this migration.
--
-- Left commented, like the sibling migrations that carry a Down block. Prisma
-- runs no down step, so an executable one here would be a statement nobody
-- calls; this is the script an operator runs by hand, kept next to the up it
-- undoes.
--
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastReadThroughAt";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastRunCompleteness";
-- ALTER TABLE "IngestionSource" DROP COLUMN "lastReadThroughAt";
-- ALTER TABLE "IngestionSource" DROP COLUMN "lastRunCompleteness";
