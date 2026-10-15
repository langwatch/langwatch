-- Budget templates for external end users, customer-owned period boundaries,
-- and reversible virtual-key disable.

ALTER TYPE "GatewayBudgetScopeType" ADD VALUE IF NOT EXISTS 'ATTRIBUTED_USER';
ALTER TYPE "GatewayBudgetWindow" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "VirtualKeyStatus" ADD VALUE IF NOT EXISTS 'DISABLED';

ALTER TABLE "VirtualKey" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "VirtualKey" ADD COLUMN "disabledReason" TEXT;

CREATE TABLE "GatewayBudgetBucketBoundary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "bucketScopeId" TEXT NOT NULL,
    "periodStartedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayBudgetBucketBoundary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GatewayBudgetBucketBoundary_budgetId_bucketScopeId_key" ON "GatewayBudgetBucketBoundary"("budgetId", "bucketScopeId");
CREATE INDEX "GatewayBudgetBucketBoundary_organizationId_idx" ON "GatewayBudgetBucketBoundary"("organizationId");

ALTER TABLE "GatewayBudgetBucketBoundary" ADD CONSTRAINT "GatewayBudgetBucketBoundary_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "GatewayBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
