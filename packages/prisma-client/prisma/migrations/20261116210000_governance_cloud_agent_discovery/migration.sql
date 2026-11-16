-- Governance's cloud agent discovery (enterprise/modules/governance/specs/cloud-agent-discovery.feature):
-- the AWS connections AWS sources sign with (same shape as the kill switch's), which source last
-- listed each discovered agent and when its listing stopped naming it, and the registry settings.
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

CREATE TABLE IF NOT EXISTS "AgentRegistrySettings" (
    "organizationId" TEXT NOT NULL,
    "dormantAfterDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRegistrySettings_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "DiscoveredAgent" ADD COLUMN IF NOT EXISTS "ingestionSourceId" TEXT,
    ADD COLUMN IF NOT EXISTS "goneAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "GovernanceAwsConnection_organizationId_idx" ON "GovernanceAwsConnection"("organizationId");

-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "DiscoveredAgent_organizationId_ingestionSourceId_idx" ON "DiscoveredAgent" ("organizationId", "ingestionSourceId");
-- A failed concurrent build leaves an invalid index: check pg_index.indisvalid and DROP INDEX CONCURRENTLY before retrying.
CREATE INDEX IF NOT EXISTS "DiscoveredAgent_organizationId_ingestionSourceId_idx" ON "DiscoveredAgent"("organizationId", "ingestionSourceId");
