-- AnomalyRule: admin-defined detection rules for the Activity Monitor.
-- See:
--   specs/ai-gateway/governance/anomaly-rules.feature
--   docs/ai-gateway/governance/architecture.md
--
-- Org-scoped (no projectId — anomaly detection is cross-platform).
-- The rule's `scope` column narrows evaluation to a sub-context
-- (organization | team | project | source_type | source). This slice
-- ships the configuration entity ONLY — eval engine + alert dispatch
-- (Option C) lands in a follow-up.

CREATE TABLE "AnomalyRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "thresholdConfig" JSONB NOT NULL DEFAULT '{}',
    "destinationConfig" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "AnomalyRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnomalyRule_organizationId_name_key"
    ON "AnomalyRule"("organizationId", "name");

CREATE INDEX "AnomalyRule_organizationId_idx"
    ON "AnomalyRule"("organizationId");

CREATE INDEX "AnomalyRule_scope_scopeId_idx"
    ON "AnomalyRule"("scope", "scopeId");

CREATE INDEX "AnomalyRule_ruleType_idx"
    ON "AnomalyRule"("ruleType");

CREATE INDEX "AnomalyRule_status_idx"
    ON "AnomalyRule"("status");

ALTER TABLE "AnomalyRule"
    ADD CONSTRAINT "AnomalyRule_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnomalyRule"
    ADD CONSTRAINT "AnomalyRule_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
