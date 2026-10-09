-- Versioned saves for the evaluations workbench.
--
-- "Experiment"."workbenchVersion" is a monotonic counter, and it is also the
-- compare-and-set guard: a writer names the version it read, and the update
-- carries that number in its WHERE, so a second writer that raced ahead makes
-- the first one match zero rows instead of overwriting the newer state.
-- Existing rows start at 0, which is what a client that never sent an expected
-- version reads. No backfill of history is needed.
--
-- "ExperimentVersion" holds one snapshot per accepted write. Ordinary typing
-- updates a single rolling row with "autoSaved" = true; a commit, an agent
-- write and a restore each insert a numbered row.
--
-- To roll back, uncomment and run manually. Dropping the table loses every
-- saved version; the live state on "Experiment" is not affected.
-- DROP TABLE "ExperimentVersion";
-- ALTER TABLE "Experiment" DROP COLUMN "workbenchVersion";

-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN "workbenchVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ExperimentVersion" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "autoSaved" BOOLEAN NOT NULL DEFAULT false,
    "commitMessage" TEXT,
    "authorId" TEXT,
    "authorLabel" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentVersion_pkey" PRIMARY KEY ("id")
);

-- One row per version number, which is what keeps the rolling autosave row and
-- the numbered rows on the same number line.
CREATE UNIQUE INDEX "ExperimentVersion_experimentId_version_key"
    ON "ExperimentVersion"("experimentId", "version");

-- The version list, and the lookup of the single rolling autosave row.
CREATE INDEX "ExperimentVersion_projectId_experimentId_autoSaved_idx"
    ON "ExperimentVersion"("projectId", "experimentId", "autoSaved");

CREATE INDEX "ExperimentVersion_createdAt_idx" ON "ExperimentVersion"("createdAt");
