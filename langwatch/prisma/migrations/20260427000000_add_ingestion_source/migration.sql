-- IngestionSource: per-platform fleet config that connects a closed
-- SaaS product's audit / OTel / S3 stream to LangWatch's Activity
-- Monitor. See:
--   specs/ai-gateway/governance/activity-monitor.feature
--   specs/ai-gateway/governance/ingestion-sources.feature
--   docs/ai-gateway/governance/architecture.md
--
-- Org-scoped (no projectId). Optional teamId narrows scope. Per-source-
-- type adapters normalise platform-specific shapes into OCSF + AOS
-- before they land in trace_summaries with SourceType + SourceId tags.

CREATE TABLE "IngestionSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT,
    "sourceType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ingestSecretHash" TEXT NOT NULL,
    "parserConfig" JSONB NOT NULL DEFAULT '{}',
    "pollerCursor" JSONB,
    "status" TEXT NOT NULL DEFAULT 'awaiting_first_event',
    "lastEventAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "IngestionSource_pkey" PRIMARY KEY ("id")
);

-- Natural key: (organizationId, name). Two "Cowork" sources can
-- coexist with different names; same name within an org collides.
CREATE UNIQUE INDEX "IngestionSource_organizationId_name_key"
    ON "IngestionSource"("organizationId", "name");

CREATE INDEX "IngestionSource_organizationId_idx"
    ON "IngestionSource"("organizationId");

CREATE INDEX "IngestionSource_teamId_idx"
    ON "IngestionSource"("teamId");

CREATE INDEX "IngestionSource_sourceType_idx"
    ON "IngestionSource"("sourceType");

ALTER TABLE "IngestionSource"
    ADD CONSTRAINT "IngestionSource_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IngestionSource"
    ADD CONSTRAINT "IngestionSource_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IngestionSource"
    ADD CONSTRAINT "IngestionSource_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
