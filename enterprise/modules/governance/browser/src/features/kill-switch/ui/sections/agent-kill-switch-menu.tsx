// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AgentKillSwitchSummary } from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import {
  isRestorableStop,
  retryStopLabelOf,
  sharedTargetHoldersOf,
} from "../../model/kill-switch-copy.ts";
import {
  type KillSwitchAction,
  KillSwitchActionsMenu,
} from "../blocks/kill-switch-actions-menu.tsx";
import { RestoreAgentDialog } from "./restore-agent-dialog.tsx";
import { RetryStopDialog } from "./retry-stop-dialog.tsx";
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
 * The kill switch actions of one agent row, and the dialog the picked action opens. Restore and
 * retry are bound to the stop open when picked; once that stop is no longer open the dialog goes,
 * and each dialog closes only itself.
 */
export function AgentKillSwitchMenu({
  organizationId,
  agentName,
  summary,
  summaries = [],
  canManage,
}: {
  organizationId: string;
  agentName: string;
  summary: AgentKillSwitchSummary;
  /** Every agent's summary, so Restore can say which shared keys stay disabled. */
  summaries?: readonly AgentKillSwitchSummary[];
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
  const retryLabel = openStop ? retryStopLabelOf(openStop.status) : null;

  return (
    <>
      <KillSwitchActionsMenu
        agentName={agentName}
        restorable={openStop !== null && isRestorableStop(openStop.status)}
        retryLabel={retryLabel}
        stopUnavailableReason={stopUnavailableReason({ summary, canManage })}
        manageHint={canManage ? null : "Needs governance:manage"}
        onPick={pick}
      />
      {dialog?.action === "stop" && <StopAgentDialog agentId={summary.agentId} {...dialogProps} />}
      {dialog?.action === "restore" && dialog.stopId !== null && openStop?.id === dialog.stopId && (
        <RestoreAgentDialog
          stopId={dialog.stopId}
          sharedTargets={sharedTargetHoldersOf({ stop: openStop, summaries })}
          {...dialogProps}
        />
      )}
      {dialog?.action === "retry" &&
        dialog.stopId !== null &&
        openStop?.id === dialog.stopId &&
        retryLabel !== null && (
          <RetryStopDialog stopId={dialog.stopId} actionLabel={retryLabel} {...dialogProps} />
        )}
      {dialog?.action === "plan" && <StopPlanDialog agentId={summary.agentId} {...dialogProps} />}
    </>
  );
}
