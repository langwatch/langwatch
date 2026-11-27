-- Governance's agent kill switch: each agent's stop plan version, so a save over a plan someone
-- else saved since it was read is refused (enterprise/modules/governance/specs/agent-kill-switch.feature).
CREATE TABLE IF NOT EXISTS "AgentStopPlan" (
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStopPlan_pkey" PRIMARY KEY ("organizationId","agentId")
);
