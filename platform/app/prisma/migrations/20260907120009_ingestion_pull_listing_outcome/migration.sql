-- What the last listing of each kind did, so a page can tell a refusal from an
-- empty tenant.
--
-- Two sets of columns, one per kind, rather than one set with a kind
-- discriminator. A source can be refused for people and fine for agents, and a
-- shared set holds only the most recent listing of either kind: syncing people
-- would erase an agents refusal, and the agents page would go back to saying
-- nothing after having briefly known. The column name carries the kind, so no
-- discriminator is needed and no reader can look at the wrong one.
--
-- A listing is a different scope on the same connection as the pull. A
-- credential that cannot enumerate a directory still pulls cost perfectly, so
-- none of these columns may be read as the source failing to pull. The pull
-- health columns above are a disjoint set and stay that way.
--
-- Counts are nullable rather than DEFAULT 0, deliberately unlike
-- lastRunEventCount. Zero means the provider returned an empty list, which is a
-- real answer from a working provider, so a zero default would state that
-- answer on behalf of a source that refused to answer at all. Null is set only
-- when the outcome is a refusal, and a refusal carries a reason instead.
--
-- Reason is TEXT and not an enum or a foreign key, because the log outlives the
-- vocabulary: a reason retired in a later release still has to replay. Status
-- is nullable even on a refusal, because a refusal generated on our own side
-- never reached the provider and so has no HTTP status.
--
-- All eleven nullable, so no replay is needed and the projection version does
-- not move. The listing events are new, so no history holds one to fold, and
-- null on every column is the true reading for a source whose history predates
-- them.

ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastAgentsListingAt" DOUBLE PRECISION;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastAgentsListingOutcome" TEXT;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastAgentsListingCount" INTEGER;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastAgentsListingReason" TEXT;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastAgentsListingStatus" INTEGER;

-- The people counts are a pair on purpose: the directory count is everyone the
-- provider named, the withheld count is how many of those erasure suppression
-- removed here. The withheld count is a SUBSET of the directory count, so
-- adding them counts the same people twice; the surviving total is the
-- subtraction, which is why it is not a third column.
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastPeopleListingAt" DOUBLE PRECISION;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastPeopleListingOutcome" TEXT;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastPeopleDirectoryCount" INTEGER;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastPeopleWithheldCount" INTEGER;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastPeopleListingReason" TEXT;
ALTER TABLE "IngestionPullRunProjection" ADD COLUMN "lastPeopleListingStatus" INTEGER;

-- Down
--
-- The up step is purely additive: eleven nullable columns on one projection
-- table, no backfill, no constraint, no index. So the reversal is the drops
-- below and nothing else, and it loses only the last listing outcome each
-- source recorded. Nothing is derived from these columns that cannot be
-- rebuilt, because the projection is folded from the event log: replaying it
-- after a re-apply restores every value.
--
-- Left commented, like the sibling migrations that carry a Down block. Prisma
-- runs no down step, so an executable one here would be a statement nobody
-- calls; this is the script an operator runs by hand, kept next to the up it
-- undoes.
--
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastAgentsListingAt";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastAgentsListingOutcome";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastAgentsListingCount";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastAgentsListingReason";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastAgentsListingStatus";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastPeopleListingAt";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastPeopleListingOutcome";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastPeopleDirectoryCount";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastPeopleWithheldCount";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastPeopleListingReason";
-- ALTER TABLE "IngestionPullRunProjection" DROP COLUMN "lastPeopleListingStatus";
