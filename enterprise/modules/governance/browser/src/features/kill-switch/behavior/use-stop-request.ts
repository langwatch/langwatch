// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Stopping one agent from the UI: the plan it reads first and the stop it sends with the target
 * ids it showed, so a plan edited in between is refused instead of stopping something unseen.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "./use-kill-switch.ts";

const PLAN_CHANGED = "agent_stop_plan_changed";

/** Why Stop cannot be confirmed yet: it waits for the plan the person is shown. */
function confirmBlockedReason({
  shown,
  isFetching,
  isError,
}: {
  shown: boolean;
  isFetching: boolean;
  isError: boolean;
}): string | undefined {
  if (shown && !isFetching) return undefined;
  if (isError && !isFetching) return "The stop plan didn't load";
  return "Loading the stop plan";
}

export function useStopRequest({
  organizationId,
  agentId,
  agentName,
  open,
}: {
  organizationId: string;
  agentId: string;
  agentName: string;
  open: boolean;
}) {
  const [planChanged, setPlanChanged] = useState<unknown>(null);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const plan = api.governanceKillSwitch.plan.useQuery(
    { organizationId, agentId },
    { enabled: open && !!organizationId, refetchOnWindowFocus: false },
  );
  const stop = api.governanceKillSwitch.requestStop.useMutation();
  const shown = plan.data && !plan.isError ? plan.data : null;
  const retry = () => void plan.refetch();

  /** Resolves true once the stop was sent; false when it was refused or not sent. */
  const requestStop = async ({ reason }: { reason: string }): Promise<boolean> => {
    if (!shown || plan.isFetching || stop.isPending) return false;
    try {
      await stop.mutateAsync({
        organizationId,
        agentId,
        reason,
        expectedTargetIds: shown.targets.map((row) => row.id),
      });
      toaster.create({ title: `Stopping ${agentName}`, type: "success" });
      await refresh.afterStopChange();
      return true;
    } catch (error) {
      if (readHandledError(error)?.code === PLAN_CHANGED) {
        setPlanChanged(error);
        await plan.refetch();
        return false;
      }
      showErrorToast({ error, fallbackTitle: "Couldn't stop the agent" });
      return false;
    }
  };

  return {
    plan: {
      targets: shown?.targets ?? null,
      isLoading: plan.isPending && !plan.isError,
      error: shown ? null : plan.error,
      retry,
    },
    planChanged,
    confirmBlockedReason: confirmBlockedReason({ shown: !!shown, ...plan }),
    isStopping: stop.isPending,
    requestStop,
    reset: () => setPlanChanged(null),
  };
}
