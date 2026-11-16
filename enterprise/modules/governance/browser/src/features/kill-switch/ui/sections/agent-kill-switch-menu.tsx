// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AgentKillSwitchSummary } from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { isRestorableStop } from "../../model/kill-switch-copy.ts";
import {
  type KillSwitchAction,
  KillSwitchActionsMenu,
} from "../blocks/kill-switch-actions-menu.tsx";
import { RestoreAgentDialog } from "./restore-agent-dialog.tsx";
import { StopAgentDialog } from "./stop-agent-dialog.tsx";
import { StopPlanDialog } from "./stop-plan-dialog.tsx";

/** Why Stop cannot be pressed, or null when it can. */
function stopUnavailableReason({
  summary,
  canManage,
}: {
  summary: AgentKillSwitchSummary;
  canManage: boolean;
}): string | null {
  if (!canManage) return "Needs governance:manage";
  if (summary.openStop) return "A stop is already open";
  if (summary.planTargetCount === 0) return "Add a stop plan first";
  return null;
}

/** The kill switch actions of one agent row, and the dialog the picked action opens. */
export function AgentKillSwitchMenu({
  organizationId,
  agentName,
  summary,
  canManage,
}: {
  organizationId: string;
  agentName: string;
  summary: AgentKillSwitchSummary;
  canManage: boolean;
}) {
  const [dialog, setDialog] = useState<KillSwitchAction | null>(null);
  const openStop = summary.openStop;
  const close = () => setDialog(null);
  const dialogProps = { organizationId, agentName, open: true, onClose: close };

  return (
    <>
      <KillSwitchActionsMenu
        agentName={agentName}
        restorable={openStop !== null && isRestorableStop(openStop.status)}
        stopUnavailableReason={stopUnavailableReason({ summary, canManage })}
        manageHint={canManage ? null : "Needs governance:manage"}
        onPick={setDialog}
      />
      {dialog === "stop" && <StopAgentDialog agentId={summary.agentId} {...dialogProps} />}
      {dialog === "restore" && openStop && (
        <RestoreAgentDialog stopId={openStop.id} {...dialogProps} />
      )}
      {dialog === "plan" && <StopPlanDialog agentId={summary.agentId} {...dialogProps} />}
    </>
  );
}
