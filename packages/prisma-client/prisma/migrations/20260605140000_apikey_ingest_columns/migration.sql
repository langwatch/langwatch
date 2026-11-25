-- An "ingestion key" is a project-scoped, ingest-only ApiKey (keyType implied
-- by ingestSourceType being non-null). These two nullable columns carry its
-- provenance: the tool slug (stamped as langwatch.source) and, for
-- template-derived keys (claude_cowork), the originating IngestionTemplate id
-- (drives OTTL + langwatch.template.id). NULL for normal API / service keys.
-- Column refs only (no FK), per the app-layer-integrity convention.

ALTER TABLE "ApiKey" ADD COLUMN "ingestSourceType" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "ingestionTemplateId" TEXT;

CREATE INDEX "ApiKey_ingestSourceType_idx" ON "ApiKey"("ingestSourceType");
CREATE INDEX "ApiKey_ingestionTemplateId_idx" ON "ApiKey"("ingestionTemplateId");
