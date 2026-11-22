// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "../../behavior/use-kill-switch.ts";

/** Stopping an agent again: what is not stopped yet, and plan targets added since, are stopped. */
export function RetryStopDialog({
  organizationId,
  stopId,
  agentName,
  actionLabel,
  open,
  onClose,
}: {
  organizationId: string;
  stopId: string;
  agentName: string;
  /** "Retry stop" or "Stop again", as the menu named it. */
  actionLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const retry = api.governanceKillSwitch.retryStop.useMutation();

  const confirm = async () => {
    try {
      await retry.mutateAsync({ organizationId, stopId });
      toaster.create({ title: `Stopping ${agentName}`, type: "success" });
      await refresh.afterStopChange();
      onClose();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't stop the agent" });
    }
  };

  const close = () => {
    if (!retry.isPending) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      role="alertdialog"
      placement="center"
      title={`${actionLabel} for ${agentName}?`}
      busy={retry.isPending}
      data-testid="retry-stop-dialog"
      primaryAction={{
        label: actionLabel,
        danger: true,
        loading: retry.isPending,
        onClick: () => void confirm(),
      }}
    >
      <Text textStyle="sm" color="fg.muted">
        This stops every target that is still running, including targets added to the stop plan
        since. Targets that are already stopped are left as they are.
      </Text>
    </Dialog>
  );
}
