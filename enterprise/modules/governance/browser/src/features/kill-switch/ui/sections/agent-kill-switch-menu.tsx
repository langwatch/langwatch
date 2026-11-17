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

/**
 * The kill switch actions of one agent row, and the dialog the picked action opens. Restore is
 * bound to the stop open when it was picked; once that stop is no longer open the dialog goes, and
 * each dialog closes only itself.
 */
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
  const [dialog, setDialog] = useState<{
    action: KillSwitchAction;
    stopId: string | null;
  } | null>(null);
  const openStop = summary.openStop;
  const pick = (action: KillSwitchAction) => setDialog({ action, stopId: openStop?.id ?? null });
  // A late close from an older dialog leaves the one picked after it open.
  const opened = dialog;
  const close = () => setDialog((current) => (current === opened ? null : current));
  const dialogProps = { organizationId, agentName, open: true, onClose: close };

  return (
    <>
      <KillSwitchActionsMenu
        agentName={agentName}
        restorable={openStop !== null && isRestorableStop(openStop.status)}
        stopUnavailableReason={stopUnavailableReason({ summary, canManage })}
        manageHint={canManage ? null : "Needs governance:manage"}
        onPick={pick}
      />
      {dialog?.action === "stop" && <StopAgentDialog agentId={summary.agentId} {...dialogProps} />}
      {dialog?.action === "restore" && dialog.stopId !== null && openStop?.id === dialog.stopId && (
        <RestoreAgentDialog stopId={dialog.stopId} {...dialogProps} />
      )}
      {dialog?.action === "plan" && <StopPlanDialog agentId={summary.agentId} {...dialogProps} />}
    </>
  );
}
