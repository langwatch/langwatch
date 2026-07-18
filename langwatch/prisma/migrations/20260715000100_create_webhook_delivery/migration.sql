-- ADR-040 §6: per-attempt webhook delivery log — the drill-down behind a
-- webhook automation's "recent fires". One row per HTTP attempt; all attempts
-- of one logical fire share `dispatchId` (== the X-LangWatch-Event-Id). A slim
-- facts table: outcome, status, latency, a capped error message and a failure
-- classification — request/response content (URL, headers, body) is never
-- stored. Rows are pruned after 30 days.

-- CreateEnum
CREATE TYPE "WebhookDeliveryOutcome" AS ENUM ('success', 'retryable', 'terminal', 'pending');

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "failureKind" TEXT,
    "outcome" "WebhookDeliveryOutcome" NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_projectId_triggerId_dispatchId_idx" ON "WebhookDelivery"("projectId", "triggerId", "dispatchId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_projectId_triggerId_firedAt_idx" ON "WebhookDelivery"("projectId", "triggerId", "firedAt");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "Trigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- To roll back, uncomment and run manually:
-- DROP TABLE "WebhookDelivery";
-- DROP TYPE "WebhookDeliveryOutcome";
