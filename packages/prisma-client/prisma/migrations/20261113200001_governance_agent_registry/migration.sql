-- Governance's agent registry and its change feed
-- (enterprise/modules/governance/specs/agent-registry.feature). All three tables are new and empty.
CREATE TABLE IF NOT EXISTS "AgentRegistryEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "entry" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRegistryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentRegistryEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fromVersion" INTEGER,
    "toVersion" INTEGER,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deliveryRecordedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRegistryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentRegistryBaseline" (
    "organizationId" TEXT NOT NULL,
    "baselinedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRegistryBaseline_pkey" PRIMARY KEY ("organizationId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentRegistryEntry_organizationId_sourceKey_key"
  ON "AgentRegistryEntry"("organizationId", "sourceKey");
CREATE INDEX IF NOT EXISTS "AgentRegistryEntry_organizationId_updatedAt_idx"
  ON "AgentRegistryEntry"("organizationId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentRegistryEvent_organizationId_sequence_key"
  ON "AgentRegistryEvent"("organizationId", "sequence");
CREATE INDEX IF NOT EXISTS "AgentRegistryEvent_organizationId_deliveryRecordedAt_idx"
  ON "AgentRegistryEvent"("organizationId", "deliveryRecordedAt");
CREATE INDEX IF NOT EXISTS "AgentRegistryEvent_organizationId_entryId_idx"
  ON "AgentRegistryEvent"("organizationId", "entryId");

-- Down (manual rollback): all three tables are new.
-- DROP TABLE IF EXISTS "AgentRegistryBaseline";
-- DROP TABLE IF EXISTS "AgentRegistryEvent";
-- DROP TABLE IF EXISTS "AgentRegistryEntry";
