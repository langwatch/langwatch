-- The counter value each saved version was written at.
--
-- "ExperimentVersion"."version" is the number a person reads, and the numbered
-- rows now hold a gap-free sequence: a commit, an agent write and a restore
-- take one more than the highest numbered row, not the counter. The rolling
-- autosave row keeps riding on "Experiment"."workbenchVersion", which is what
-- keeps its number clear of that sequence, and it is displayed as "Autosave"
-- with no number at all.
--
-- That leaves nothing on a row saying how recent its content is: the rolling
-- row is rewritten in place, so its createdAt is the start of the session and
-- its version is a counter value the numbered rows no longer follow.
-- "counterVersion" records the counter at the moment the row was last written.
-- The version list orders and pages by it, and the row whose counterVersion
-- equals the experiment's counter is the one holding the live state.
--
-- Every existing row was written at the counter it carries in "version", so
-- the backfill is that equality.
--
-- To roll back, uncomment and run manually. Dropping the column loses the
-- recency of the rolling autosave row; no other data is affected.
-- DROP INDEX "ExperimentVersion_projectId_experimentId_counterVersion_idx";
-- ALTER TABLE "ExperimentVersion" DROP COLUMN "counterVersion";

-- LOCKING NOTE: `SET NOT NULL` takes an ACCESS EXCLUSIVE lock and plain
-- `CREATE INDEX` blocks writes for the length of the build, so version writes
-- wait. "ExperimentVersion" holds a few rows per experiment and this runs
-- during deploy, so the pause is short. The `CONCURRENTLY` form would avoid the
-- lock but cannot run inside a transaction, which the Prisma migration runner
-- requires.

-- AlterTable
ALTER TABLE "ExperimentVersion" ADD COLUMN "counterVersion" INTEGER;

UPDATE "ExperimentVersion"
SET "counterVersion" = "version"
WHERE "counterVersion" IS NULL;

ALTER TABLE "ExperimentVersion" ALTER COLUMN "counterVersion" SET NOT NULL;

-- CreateIndex
-- The version list reads one experiment's rows newest first
-- ("projectId" = ? AND "experimentId" = ? AND "counterVersion" < ? ORDER BY
-- "counterVersion" DESC), so the sort key goes in the index.
CREATE INDEX IF NOT EXISTS "ExperimentVersion_projectId_experimentId_counterVersion_idx"
    ON "ExperimentVersion"("projectId", "experimentId", "counterVersion");
