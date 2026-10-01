-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "enabledEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "disabledReason" TEXT,
    "disabledAt" TIMESTAMP(3),
    "failingSince" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpointDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "responseStatus" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "response" JSONB,
    "outcome" "WebhookDeliveryOutcome" NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpointDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_organizationId_status_idx" ON "WebhookEndpoint"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WebhookEndpointDelivery_endpointId_firedAt_idx" ON "WebhookEndpointDelivery"("endpointId", "firedAt");

-- CreateIndex
CREATE INDEX "WebhookEndpointDelivery_organizationId_firedAt_idx" ON "WebhookEndpointDelivery"("organizationId", "firedAt");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpointDelivery" ADD CONSTRAINT "WebhookEndpointDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Down (manual): reverses in dependency order; run only to roll back this
-- migration.
--   ALTER TABLE "WebhookEndpointDelivery" DROP CONSTRAINT "WebhookEndpointDelivery_endpointId_fkey";
--   ALTER TABLE "WebhookEndpoint" DROP CONSTRAINT "WebhookEndpoint_organizationId_fkey";
--   DROP TABLE "WebhookEndpointDelivery";
--   DROP TABLE "WebhookEndpoint";
--   DROP TYPE "WebhookEndpointStatus";
