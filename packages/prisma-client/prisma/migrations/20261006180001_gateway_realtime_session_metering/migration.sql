-- Realtime voice metering the client cannot skip, owned by gateway (ADR-097).
--
-- GatewayRealtimeSession gains what the session is (kind), who measures it
-- (metering), the end user it is attributed to, how long its credential lives
-- and a running total of the usage
-- reports recorded while it ran. GatewayRealtimeSessionReport holds one row
-- per report, unique per (session, report key), so a redelivered report
-- counts once.
--
-- Expand only: every new column is nullable or defaulted, so the release
-- still serving keeps inserting sessions without naming them.
--
-- Spec: modules/gateway/specs/gateway-realtime-session-metering.feature
--
-- IRREVERSIBLE: there is no down migration. The schema part reverses by hand:
--
--   DROP TABLE "GatewayRealtimeSessionReport";
--   DROP INDEX "GatewayRealtimeSession_status_metering_mintedAt_idx";
--   ALTER TABLE "GatewayRealtimeSession" DROP COLUMN "kind", DROP COLUMN "metering",
--     DROP COLUMN "credentialExpiresAt", DROP COLUMN "transcriptionModel", DROP COLUMN "endUserId",
--     DROP COLUMN "lastReportAt", DROP COLUMN "reportedCostNanoUsd", DROP COLUMN "reportCount";

ALTER TABLE "GatewayRealtimeSession"
    ADD COLUMN "kind" TEXT,
    ADD COLUMN "metering" TEXT,
    ADD COLUMN "credentialExpiresAt" TIMESTAMP(3),
    ADD COLUMN "transcriptionModel" TEXT,
    ADD COLUMN "endUserId" TEXT,
    ADD COLUMN "lastReportAt" TIMESTAMP(3),
    ADD COLUMN "reportedCostNanoUsd" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "reportCount" INTEGER NOT NULL DEFAULT 0;

-- Ops pre-build note: this index lands on an existing table, and a plain build
-- blocks its writes while it runs. A deployment with real traffic builds it
-- ahead, outside Prisma's transaction, as in 20261006120000_process_outbox_lease_by_process_index:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "GatewayRealtimeSession_status_metering_mintedAt_idx"
--     ON "GatewayRealtimeSession" ("status", "metering", "mintedAt");
-- and this statement is then the no-op that records the same intent.
CREATE INDEX IF NOT EXISTS "GatewayRealtimeSession_status_metering_mintedAt_idx"
    ON "GatewayRealtimeSession"("status", "metering", "mintedAt");

CREATE TABLE "GatewayRealtimeSessionReport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "usage" JSONB NOT NULL,
    "costNanoUsd" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayRealtimeSessionReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GatewayRealtimeSessionReport_sessionId_reportKey_key"
    ON "GatewayRealtimeSessionReport"("sessionId", "reportKey");

CREATE INDEX "GatewayRealtimeSessionReport_projectId_idx"
    ON "GatewayRealtimeSessionReport"("projectId");
