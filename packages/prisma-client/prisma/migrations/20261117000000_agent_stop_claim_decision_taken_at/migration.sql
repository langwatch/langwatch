-- When a pending stop's decision was taken, so one whose command never landed can be taken over
-- once abandoned (enterprise/modules/governance/specs/agent-kill-switch.feature).
ALTER TABLE "AgentStopClaim" ADD COLUMN IF NOT EXISTS "decisionTakenAt" TIMESTAMP(3);
