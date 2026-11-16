// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Approving or denying a pending stop, with the toast and the refresh each decision ends with.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "./use-kill-switch.ts";

export function useStopDecisions({ organizationId }: { organizationId: string }) {
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const approve = api.governanceKillSwitch.approveStop.useMutation();
  const deny = api.governanceKillSwitch.denyStop.useMutation();

  /** Resolves true when the stop was approved. */
  const approveStop = async (stop: AgentStopView): Promise<boolean> => {
    try {
      await approve.mutateAsync({ organizationId, stopId: stop.id });
      toaster.create({ title: `Stopping ${stop.agentName}`, type: "success" });
      await refresh.afterStopChange();
      return true;
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't approve the stop" });
      return false;
    }
  };

  /** Resolves true when the stop was denied. */
  const denyStop = async ({ stop, note }: { stop: AgentStopView; note: string }) => {
    const trimmed = note.trim();
    try {
      await deny.mutateAsync({
        organizationId,
        stopId: stop.id,
        ...(trimmed ? { note: trimmed } : {}),
      });
      toaster.create({ title: `Stop of ${stop.agentName} denied`, type: "info" });
      await refresh.afterStopChange();
      return true;
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't deny the stop" });
      return false;
    }
  };

  return {
    approveStop,
    denyStop,
    approvingStopId: approve.isPending ? (approve.variables?.stopId ?? null) : null,
    isDenying: deny.isPending,
  };
}
