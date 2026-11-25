-- IRREVERSIBLE: adds tables and nullable columns; migrations never drop one, a drop is an operator step.
-- Agent versions and deploy labels, owned by the agent module. Version 1 of existing agents and their
-- creators are filled by the background step agent:backfill-versions.
-- Spec: modules/agent/specs/agent-versioning.feature
CREATE TABLE IF NOT EXISTS "AgentVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "workflowId" TEXT,
    "commitMessage" TEXT,
    "authorId" TEXT,
    "authorKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentVersion_agentId_version_key" ON "AgentVersion"("agentId", "version");
CREATE INDEX IF NOT EXISTS "AgentVersion_projectId_idx" ON "AgentVersion"("projectId");

CREATE TABLE IF NOT EXISTS "AgentVersionLabel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentVersionLabel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentVersionLabel_agentId_label_key" ON "AgentVersionLabel"("agentId", "label");
CREATE INDEX IF NOT EXISTS "AgentVersionLabel_projectId_idx" ON "AgentVersionLabel"("projectId");
CREATE INDEX IF NOT EXISTS "AgentVersionLabel_versionId_idx" ON "AgentVersionLabel"("versionId");

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "createdById" TEXT, ADD COLUMN IF NOT EXISTS "updatedById" TEXT;
