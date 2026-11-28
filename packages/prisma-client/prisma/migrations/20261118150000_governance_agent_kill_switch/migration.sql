-- Governance's agent kill switch (enterprise/modules/governance/specs/agent-kill-switch.feature):
-- stop plans, the AWS connections Bedrock targets sign with, and the stop projection. All new.
CREATE TABLE IF NOT EXISTS "AgentStopPlanTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStopPlanTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GovernanceAwsConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessKeyId" TEXT,
    "encryptedSecretAccessKey" TEXT,
    "roleArn" TEXT,
    "encryptedExternalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceAwsConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentStop" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "approval" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedByApiKeyId" TEXT,
    "decidedByUserId" TEXT,
    "decidedByApiKeyId" TEXT,
    "restoredByUserId" TEXT,
    "restoredByApiKeyId" TEXT,
    "targets" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "restoreRequestedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "lastAppliedEventId" TEXT NOT NULL,
    "lastAcceptedAt" BIGINT NOT NULL,
    "lastOccurredAt" BIGINT NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentStopClaim" (
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "decision" TEXT,
    "decisionTakenAt" TIMESTAMP(3),

    CONSTRAINT "AgentStopClaim_pkey" PRIMARY KEY ("organizationId","agentId")
);

CREATE TABLE IF NOT EXISTS "AgentStopTargetPriorState" (
    "organizationId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "wasStopped" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentStopTargetPriorState_pkey" PRIMARY KEY ("organizationId","stopId","targetId")
);

CREATE INDEX IF NOT EXISTS "AgentStopPlanTarget_organizationId_agentId_idx" ON "AgentStopPlanTarget"("organizationId", "agentId");

CREATE INDEX IF NOT EXISTS "GovernanceAwsConnection_organizationId_idx" ON "GovernanceAwsConnection"("organizationId");

CREATE INDEX IF NOT EXISTS "AgentStop_organizationId_agentId_idx" ON "AgentStop"("organizationId", "agentId");

CREATE INDEX IF NOT EXISTS "AgentStop_organizationId_status_idx" ON "AgentStop"("organizationId", "status");
