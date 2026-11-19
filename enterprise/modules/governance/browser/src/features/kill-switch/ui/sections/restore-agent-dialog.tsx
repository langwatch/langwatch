// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "../../behavior/use-kill-switch.ts";
import { sharedKeyNoteOf } from "../../model/kill-switch-copy.ts";

/** Restoring a stopped agent: only the targets the stop applied are turned back on. */
export function RestoreAgentDialog({
  organizationId,
  stopId,
  agentName,
  sharedKeyHolders = [],
  open,
  onClose,
}: {
  organizationId: string;
  stopId: string;
  agentName: string;
  /** Other stopped agents sharing one of this stop's virtual keys. */
  sharedKeyHolders?: readonly string[];
  open: boolean;
  onClose: () => void;
}) {
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const restore = api.governanceKillSwitch.restore.useMutation();

  const confirm = async () => {
    try {
      await restore.mutateAsync({ organizationId, stopId });
      toaster.create({
        title: `Restoring ${agentName}`,
        ...(sharedKeyHolders.length > 0
          ? { description: "The shared virtual key stays disabled." }
          : {}),
        type: "success",
      });
      await refresh.afterStopChange();
      onClose();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't restore the agent" });
    }
  };

  const close = () => {
    if (!restore.isPending) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      role="alertdialog"
      placement="center"
      title={`Restore ${agentName}?`}
      busy={restore.isPending}
      data-testid="restore-agent-dialog"
      primaryAction={{
        label: "Restore agent",
        loading: restore.isPending,
        onClick: () => void confirm(),
      }}
    >
      <Text textStyle="sm" color="fg.muted">
        This turns back on what the stop turned off, so the agent takes traffic again.
      </Text>
      {sharedKeyHolders.length > 0 ? (
        <Text textStyle="sm" color="fg.muted" data-testid="restore-shared-key-note">
          {sharedKeyNoteOf({ holders: sharedKeyHolders })}
        </Text>
      ) : null}
    </Dialog>
  );
}
