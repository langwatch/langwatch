-- Phase 10 — pull-mode IngestionSource fields driven by the
-- PullerAdapter framework + BullMQ worker.
--
-- errorCount: consecutive failure counter; reset on success. Drives
-- admin-UI banners + back-off scheduling.
--
-- pullSchedule: cron expression copied from pullConfig.schedule for
-- fast worker dispatch (avoids JSON parse on every hot-path lookup).
-- Null for push-mode sources (otel_generic / claude_cowork / workato /
-- s3_custom legacy push variants).
--
-- Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
ALTER TABLE "IngestionSource"
  ADD COLUMN "errorCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "IngestionSource"
  ADD COLUMN "pullSchedule" TEXT;
