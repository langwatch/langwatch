// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Menu } from "@langwatch/design-system/menu";
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import type { AgentKillSwitchSummary } from "@langwatch/enterprise-governance-contract";
import { ListChecks, MoreVertical, OctagonX, RotateCcw } from "lucide-react";
import { useState } from "react";

import { isRestorableStop } from "../../model/kill-switch-copy.ts";
import { RestoreAgentDialog } from "./restore-agent-dialog.tsx";
import { StopAgentDialog } from "./stop-agent-dialog.tsx";
import { StopPlanDialog } from "./stop-plan-dialog.tsx";

type OpenDialog = "stop" | "restore" | "plan" | null;

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

function ItemLabel({ label, hint }: { label: string; hint: string | null }) {
  return (
    <VStack align="start" gap={0}>
      <Text as="span">{label}</Text>
      {hint ? (
        <Text as="span" textStyle="xs" color="fg.muted">
          {hint}
        </Text>
      ) : null}
    </VStack>
  );
}

/**
 * The kill switch actions of one agent row: Stop, Restore and the stop plan, in the row's
 * overflow menu (dev/docs/best_practices/row-actions-overflow-menu.md).
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
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const openStop = summary.openStop;
  const restorable = openStop !== null && isRestorableStop(openStop.status);
  const stopReason = stopUnavailableReason({ summary, canManage });
  const manageHint = canManage ? null : "Needs governance:manage";
  const close = () => setDialog(null);

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="xs" variant="ghost" aria-label={`Actions for ${agentName}`}>
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {restorable ? (
            <Menu.Item
              value="restore"
              disabled={!canManage}
              onClick={(event) => {
                event.stopPropagation();
                setDialog("restore");
              }}
            >
              <RotateCcw size={14} /> <ItemLabel label="Restore" hint={manageHint} />
            </Menu.Item>
          ) : (
            <Menu.Item
              value="stop"
              color="red.fg"
              disabled={stopReason !== null}
              onClick={(event) => {
                event.stopPropagation();
                setDialog("stop");
              }}
            >
              <OctagonX size={14} /> <ItemLabel label="Stop" hint={stopReason} />
            </Menu.Item>
          )}
          <Menu.Item
            value="plan"
            disabled={!canManage}
            onClick={(event) => {
              event.stopPropagation();
              setDialog("plan");
            }}
          >
            <ListChecks size={14} /> <ItemLabel label="Stop plan" hint={manageHint} />
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
      {dialog === "stop" && (
        <StopAgentDialog
          organizationId={organizationId}
          agentId={summary.agentId}
          agentName={agentName}
          open
          onClose={close}
        />
      )}
      {dialog === "restore" && openStop && (
        <RestoreAgentDialog
          organizationId={organizationId}
          stopId={openStop.id}
          agentName={agentName}
          open
          onClose={close}
        />
      )}
      {dialog === "plan" && (
        <StopPlanDialog
          organizationId={organizationId}
          agentId={summary.agentId}
          agentName={agentName}
          open
          onClose={close}
        />
      )}
    </>
  );
}
