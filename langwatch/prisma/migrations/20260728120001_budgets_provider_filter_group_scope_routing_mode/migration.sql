-- Budgets on every dimension: a provider filter orthogonal to the target,
-- a per-member GROUP (department) tier, and an explicit routing mode on
-- virtual keys so "no fallback" is representable.

-- AlterEnum
ALTER TYPE "GatewayBudgetScopeType" ADD VALUE 'GROUP';

-- CreateEnum
CREATE TYPE "VirtualKeyRoutingMode" AS ENUM ('NONE', 'FALLBACK_ALL', 'POLICY');

-- AlterTable
ALTER TABLE "GatewayBudget" ADD COLUMN "providerKey" TEXT;

-- AlterTable
ALTER TABLE "GatewayBudgetLedger" ADD COLUMN "providerKey" TEXT;

-- AlterTable
ALTER TABLE "VirtualKey" ADD COLUMN "routingMode" "VirtualKeyRoutingMode" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX "GatewayBudget_scopeType_scopeId_providerKey_idx" ON "GatewayBudget"("scopeType", "scopeId", "providerKey");

-- Behaviour-preserving backfill. Every key that exists today routes with
-- the old implicit default (a null policy meant "fall back across every
-- eligible provider"), so pin existing rows to that meaning explicitly.
-- Only keys created after this migration get the new NONE default.
UPDATE "VirtualKey" SET "routingMode" = 'FALLBACK_ALL' WHERE "routingPolicyId" IS NULL;
UPDATE "VirtualKey" SET "routingMode" = 'POLICY' WHERE "routingPolicyId" IS NOT NULL;
