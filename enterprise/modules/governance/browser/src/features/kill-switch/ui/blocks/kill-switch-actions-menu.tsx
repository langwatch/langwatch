// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Menu } from "@langwatch/design-system/menu";
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import { ListChecks, MoreVertical, OctagonX, RotateCcw } from "lucide-react";

export type KillSwitchAction = "stop" | "retry" | "restore" | "plan";

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
 * One agent row's overflow menu: Restore when its stop can be restored, Stop otherwise, a way to
 * stop an open stop again, and the stop plan. A shut item says why
 * (dev/docs/best_practices/row-actions-overflow-menu.md).
 */
export function KillSwitchActionsMenu({
  agentName,
  restorable,
  retryLabel,
  stopUnavailableReason,
  manageHint,
  onPick,
}: {
  agentName: string;
  restorable: boolean;
  /** "Retry stop" or "Stop again" when the open stop can be stopped again, else null. */
  retryLabel: string | null;
  stopUnavailableReason: string | null;
  manageHint: string | null;
  onPick: (action: KillSwitchAction) => void;
}) {
  const pick = (action: KillSwitchAction) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onPick(action);
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" aria-label={`Actions for ${agentName}`}>
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {retryLabel ? (
          <Menu.Item
            value="retry"
            color="red.fg"
            disabled={manageHint !== null}
            onClick={pick("retry")}
          >
            <OctagonX size={14} /> <ItemLabel label={retryLabel} hint={manageHint} />
          </Menu.Item>
        ) : null}
        {restorable ? (
          <Menu.Item value="restore" disabled={manageHint !== null} onClick={pick("restore")}>
            <RotateCcw size={14} /> <ItemLabel label="Restore" hint={manageHint} />
          </Menu.Item>
        ) : (
          <Menu.Item
            value="stop"
            color="red.fg"
            disabled={stopUnavailableReason !== null}
            onClick={pick("stop")}
          >
            <OctagonX size={14} /> <ItemLabel label="Stop" hint={stopUnavailableReason} />
          </Menu.Item>
        )}
        <Menu.Item value="plan" disabled={manageHint !== null} onClick={pick("plan")}>
          <ListChecks size={14} /> <ItemLabel label="Stop plan" hint={manageHint} />
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
