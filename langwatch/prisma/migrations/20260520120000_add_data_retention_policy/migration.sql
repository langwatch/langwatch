-- Data retention foundation.
--
-- Retention policies are scoped resources (ADR-021): single-scope-per-row,
-- inline (scopeType, scopeId) + an organizationId anchor, one row per
-- (scope, category). Resolution cascades PROJECT -> TEAM -> ORGANIZATION ->
-- platform default (49 days). The ClickHouse migration default for rows that
-- predate the retention column is separate and intentionally 308 days. No JSON
-- policy columns on Organization/Project — those are the shape ADR-021
-- explicitly rejects.
--
-- PinnedTrace records trace pin/share UI annotations. Pins do not exempt
-- ClickHouse rows from retention; `source` distinguishes a manual pin from an
-- auto-pin created on share.

-- CreateEnum
CREATE TYPE "PinSource" AS ENUM ('manual', 'share');

-- CreateEnum
CREATE TYPE "RetentionPolicyScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');

-- CreateTable
CREATE TABLE "PinnedTrace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "userId" TEXT,
    "source" "PinSource" NOT NULL DEFAULT 'manual',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinnedTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PinnedTrace_projectId_traceId_key" ON "PinnedTrace"("projectId", "traceId");

-- CreateIndex
CREATE INDEX "PinnedTrace_projectId_idx" ON "PinnedTrace"("projectId");

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "RetentionPolicyScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_scopeType_scopeId_category_key" ON "RetentionPolicy"("scopeType", "scopeId", "category");

-- CreateIndex
CREATE INDEX "RetentionPolicy_organizationId_idx" ON "RetentionPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "RetentionPolicy_scopeType_scopeId_idx" ON "RetentionPolicy"("scopeType", "scopeId");
