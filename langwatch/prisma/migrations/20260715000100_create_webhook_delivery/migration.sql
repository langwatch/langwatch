-- ADR-040 §6: per-attempt webhook delivery log — the drill-down behind a
-- webhook automation's "recent fires". One row per HTTP attempt; all attempts
-- of one logical fire share `dispatchId` (== the X-LangWatch-Event-Id). Header
-- values are stored REDACTED (every value masked to '***'); `requestUrl` is
-- stored as origin + path only (query string and any embedded credentials are
-- stripped before persistence); the response snippet is size-capped by the
-- writer. Rows are pruned after 30 days, scoped by projectId.

-- CreateEnum
CREATE TYPE "WebhookDeliveryOutcome" AS ENUM ('success', 'retryable', 'terminal', 'pending');

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "requestMethod" TEXT NOT NULL,
    "requestUrl" TEXT NOT NULL,
    "requestHeaders" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "latencyMs" INTEGER,
    "error" TEXT,
    "outcome" "WebhookDeliveryOutcome" NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_projectId_triggerId_dispatchId_idx" ON "WebhookDelivery"("projectId", "triggerId", "dispatchId");

-- CreateIndex
-- Indexes the projectId-scoped 30-day prune (`projectId IN (...) AND firedAt < before`).
CREATE INDEX "WebhookDelivery_projectId_firedAt_idx" ON "WebhookDelivery"("projectId", "firedAt");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "Trigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IRREVERSIBLE: Prisma migrations are forward-only — this create has no
-- automatic down step. To roll back manually, run:
--   DROP TABLE "WebhookDelivery";
--   DROP TYPE "WebhookDeliveryOutcome";
