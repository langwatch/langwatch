-- Test case versions: every save writes a snapshot, so a person can read what
-- a case looked like when a run used it, and restore it.
--
-- `Scenario.version` defaults to 1 so every case that existed before this
-- migration reads as its own first version with no backfill. The unique index
-- on (scenarioId, version) is what makes a concurrent double save fail loudly
-- instead of writing two rows that both claim the same number.
ALTER TABLE "Scenario" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ScenarioVersion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "authorId" TEXT,
    "authorLabel" TEXT NOT NULL,
    "changeDescription" TEXT,
    "snapshot" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioVersion_pkey" PRIMARY KEY ("id")
);

-- Supports "the history of THIS case in THIS project, newest first", which the
-- History drawer and the version REST reads both issue.
CREATE INDEX "ScenarioVersion_projectId_scenarioId_version_idx" ON "ScenarioVersion"("projectId", "scenarioId", "version");

-- Supports the retention sweep, which walks versions by age across tenants.
CREATE INDEX "ScenarioVersion_createdAt_idx" ON "ScenarioVersion"("createdAt");

CREATE UNIQUE INDEX "ScenarioVersion_scenarioId_version_key" ON "ScenarioVersion"("scenarioId", "version");

-- IRREVERSIBLE: dropping "ScenarioVersion" destroys every saved snapshot.
--
-- The table is the only place a past version of a case exists. `Scenario`
-- holds the current values only, so a DROP TABLE does not return the database
-- to its prior state, it deletes history that was never anywhere else, and
-- every run stamped with a version number then points at nothing.
--
-- To reverse this deliberately, the snapshots must be dealt with FIRST, while
-- they can still be read: exported, or discarded on purpose. That is a data
-- decision, not a schema one, so it is not scripted here. Repair goes forward,
-- in a new migration.
--
-- Dropping "Scenario"."version" alone is safe and independent: every case then
-- reads as unversioned again, which is what it was before.
--   ALTER TABLE "Scenario" DROP COLUMN "version";
