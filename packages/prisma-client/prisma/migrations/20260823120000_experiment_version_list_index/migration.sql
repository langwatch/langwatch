-- The version list reads one experiment's rows newest first
-- ("projectId" = ? AND "experimentId" = ? AND "version" < ? ORDER BY "version"
-- DESC), and a restore reads one version number of one experiment. Both name
-- all three columns, so the sort key goes in the index instead of being
-- applied to rows that were already fetched.
--
-- A separate migration rather than an edit of
-- 20260822120000_experiment_workbench_versions: that one is already applied in
-- development databases, and changing an applied file breaks its checksum.
--
-- To roll back, uncomment and run manually. Dropping the index only costs the
-- version list its sorted read path; no data is affected.
-- DROP INDEX "ExperimentVersion_projectId_experimentId_version_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExperimentVersion_projectId_experimentId_version_idx"
    ON "ExperimentVersion"("projectId", "experimentId", "version");
