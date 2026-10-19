-- Unified data-privacy policy (ADR-021).
--
-- Collapses the previously separate privacy controls
-- (Organization.governanceLogContentMode, Project.capturedInputVisibility /
-- capturedOutputVisibility, Project.piiRedactionLevel) into one scoped
-- resource: single-scope-per-row, inline (scopeType, scopeId, personalOnly) +
-- an organizationId anchor, one row per scope, carrying a DataPrivacyConfig
-- JSON blob (content disposition per category, restrict audience, PII level,
-- secrets redaction, extra drop-keys). Resolution cascades
-- PROJECT -> DEPARTMENT -> TEAM -> ORGANIZATION per field; personalOnly narrows
-- ORGANIZATION / DEPARTMENT rules to personal (per-user) projects.
--
-- This migration creates the table only. Backfill from the legacy columns is
-- performed by the tested backfill routine (src/server/data-privacy/backfill)
-- and verified before the legacy columns are dropped in a later migration;
-- until then the resolver falls back to the legacy columns, so behavior is
-- preserved whether or not rows have been backfilled.

-- CreateEnum
CREATE TYPE "DataPrivacyScopeType" AS ENUM ('ORGANIZATION', 'DEPARTMENT', 'TEAM', 'PROJECT');

-- CreateTable
CREATE TABLE "DataPrivacyPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "DataPrivacyScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "personalOnly" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataPrivacyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataPrivacyPolicy_scopeType_scopeId_personalOnly_key" ON "DataPrivacyPolicy"("scopeType", "scopeId", "personalOnly");

-- CreateIndex
CREATE INDEX "DataPrivacyPolicy_organizationId_idx" ON "DataPrivacyPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "DataPrivacyPolicy_scopeType_scopeId_idx" ON "DataPrivacyPolicy"("scopeType", "scopeId");
