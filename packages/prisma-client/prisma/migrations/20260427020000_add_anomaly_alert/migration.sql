-- AnomalyAlert: persisted detections from the AnomalyEvaluatorService
-- (Option C). Inserted when a rule's threshold trips against
-- gateway_activity_events. Read by api.activityMonitor.recentAnomalies.
--
-- Dedup: (ruleId, triggerWindowStart) — re-evaluating the same window
-- updates the existing row rather than creating a duplicate.
--
-- See:
--   specs/ai-gateway/governance/anomaly-detection.feature

CREATE TABLE "AnomalyAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "triggerWindowStart" TIMESTAMP(3) NOT NULL,
    "triggerWindowEnd" TIMESTAMP(3) NOT NULL,
    "triggerSpendUsd" DECIMAL(18,6),
    "triggerEventCount" INTEGER,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'open',
    "destinationStatus" JSONB NOT NULL DEFAULT '{}',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AnomalyAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnomalyAlert_ruleId_triggerWindowStart_key"
    ON "AnomalyAlert"("ruleId", "triggerWindowStart");

CREATE INDEX "AnomalyAlert_organizationId_detectedAt_idx"
    ON "AnomalyAlert"("organizationId", "detectedAt");

CREATE INDEX "AnomalyAlert_ruleId_idx"
    ON "AnomalyAlert"("ruleId");

CREATE INDEX "AnomalyAlert_state_idx"
    ON "AnomalyAlert"("state");

ALTER TABLE "AnomalyAlert"
    ADD CONSTRAINT "AnomalyAlert_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnomalyAlert"
    ADD CONSTRAINT "AnomalyAlert_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "AnomalyRule"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
