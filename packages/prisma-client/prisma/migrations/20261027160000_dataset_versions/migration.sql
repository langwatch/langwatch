-- IRREVERSIBLE: adds tables; migrations never drop one, a drop is an operator step.
-- Dataset versions and the experiment runs that read them, owned by the dataset module. Version 1 of
-- existing datasets is written by the background step dataset:create-first-versions.
-- Spec: modules/dataset/specs/dataset-versioning.feature
CREATE TABLE IF NOT EXISTS "DatasetVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT,
    "trigger" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "columnTypes" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "restoredFromVersion" INTEGER,
    "authorId" TEXT,
    "authorKind" TEXT,
    "pinnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatasetVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DatasetVersion_datasetId_version_key" ON "DatasetVersion"("datasetId", "version");
CREATE INDEX IF NOT EXISTS "DatasetVersion_projectId_datasetId_idx" ON "DatasetVersion"("projectId", "datasetId");

CREATE TABLE IF NOT EXISTS "DatasetVersionRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "experimentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatasetVersionRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DatasetVersionRun_projectId_runId_datasetId_key" ON "DatasetVersionRun"("projectId", "runId", "datasetId");
CREATE INDEX IF NOT EXISTS "DatasetVersionRun_versionId_idx" ON "DatasetVersionRun"("versionId");
