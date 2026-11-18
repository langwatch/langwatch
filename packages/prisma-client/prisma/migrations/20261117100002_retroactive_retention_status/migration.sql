-- Data retention's per-project retroactive retention status (ADR-202 Decided 13). A new table only;
-- the previous release never reads it. Rollback is dropping it, an operator step.

-- CreateTable
CREATE TABLE IF NOT EXISTS "RetroactiveRetentionStatus" (
    "projectId" TEXT NOT NULL,
    "pending" JSONB NOT NULL DEFAULT '[]',
    "mutations" JSONB NOT NULL DEFAULT '[]',
    "failed" JSONB NOT NULL DEFAULT '[]',
    "closedRequestIds" JSONB NOT NULL DEFAULT '[]',
    "issued" JSONB NOT NULL DEFAULT '[]',
    "lastAppliedEventId" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetroactiveRetentionStatus_pkey" PRIMARY KEY ("projectId")
);
