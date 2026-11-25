// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The agent kill switch on the Agents page: status chips, row actions, approvals and the stop plan.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
export { useKillSwitchReads } from "./behavior/use-kill-switch.ts";
export { AgentStopStatusChip } from "./ui/elements/agent-stop-status-chip.tsx";
export { AgentKillSwitchMenu } from "./ui/sections/agent-kill-switch-menu.tsx";
export { StopApprovalsCard } from "./ui/sections/stop-approvals-card.tsx";
