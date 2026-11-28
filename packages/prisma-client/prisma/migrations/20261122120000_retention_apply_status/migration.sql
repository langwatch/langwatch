-- IRREVERSIBLE: creates the "RetentionApplyStatus" table.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- Per retention scope, the latest change saved there, the latest exact apply and raise it asked
-- for, and the latest change that did not lengthen the period, so the settings page says whether a
-- change was applied
-- (modules/data-retention/specs/retention-apply-record.feature). Expand only; rebuilt by a replay.
CREATE TABLE IF NOT EXISTS "RetentionApplyStatus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "RetentionPolicyScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "changedAt" DOUBLE PRECISION,
    "appliedAt" DOUBLE PRECISION,
    "raisedAt" DOUBLE PRECISION,
    "shortenedAt" DOUBLE PRECISION,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    "occurredAt" DOUBLE PRECISION NOT NULL,
    "acceptedAt" DOUBLE PRECISION NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "projectionVersion" TEXT NOT NULL,

    CONSTRAINT "RetentionApplyStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RetentionApplyStatus_organizationId_scopeType_scopeId_key"
  ON "RetentionApplyStatus"("organizationId", "scopeType", "scopeId");
