-- The Instant Evals judge leaf's own tables (ADR-174 decision 13, Schema). New tables only;
-- rollback is dropping them.

-- CreateTable
CREATE TABLE IF NOT EXISTS "InstantEvalJudgeProject" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstantEvalJudgeProject_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InstantEvalJudgeUsageBilling" (
    "organizationId" TEXT NOT NULL,
    "usageBilled" BOOLEAN NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "fromCatchUp" BOOLEAN NOT NULL,

    CONSTRAINT "InstantEvalJudgeUsageBilling_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "InstantEvalJudgeSpend" (
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "spendNanoUsd" BIGINT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstantEvalJudgeSpend_pkey" PRIMARY KEY ("organizationId","requestId")
);
