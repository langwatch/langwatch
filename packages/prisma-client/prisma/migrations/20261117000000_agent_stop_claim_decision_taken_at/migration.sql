-- When a pending stop's decision was taken, set while its command is in flight, so one whose
-- process died before sending can be taken over once abandoned
-- (enterprise/modules/governance/specs/agent-kill-switch.feature).
-- IRREVERSIBLE: a rollback leaves this nullable column in place; the previous release never reads
-- it, and a column is dropped only as an operator step once no release needs it.
ALTER TABLE "AgentStopClaim" ADD COLUMN IF NOT EXISTS "decisionTakenAt" TIMESTAMP(3);
