-- Governance's cloud agent discovery (enterprise/modules/governance/specs/cloud-agent-discovery.feature):
-- each source's presence fact for the agents it listed, and the registry settings. AWS sources
-- sign with the kill switch's GovernanceAwsConnection rows.
-- IRREVERSIBLE: no down step. Every statement adds a new table or index; rolling the release back
-- leaves them in place unused, and dropping one is an operator step, never a migration.
CREATE TABLE IF NOT EXISTS "AgentRegistrySettings" (
    "organizationId" TEXT NOT NULL,
    "dormantAfterDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRegistrySettings_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE IF NOT EXISTS "DiscoveredAgentListing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ingestionSourceId" TEXT NOT NULL,
    "discoveredAgentId" TEXT NOT NULL,
    "lastListedAt" TIMESTAMP(3) NOT NULL,
    "goneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredAgentListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveredAgentListing_ingestionSourceId_discoveredAgentId_key" ON "DiscoveredAgentListing"("ingestionSourceId", "discoveredAgentId");

CREATE INDEX IF NOT EXISTS "DiscoveredAgentListing_organizationId_discoveredAgentId_idx" ON "DiscoveredAgentListing"("organizationId", "discoveredAgentId");
