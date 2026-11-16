// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The kill switch reads of the Agents page and the refresh every write ends with.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { api } from "../../../behavior/governance-api.ts";
import { summariesByRowId } from "../model/kill-switch-copy.ts";

/** Each row's open stop and plan size, plus the stops waiting for a decision. */
export function useKillSwitchReads({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  const active = enabled && !!organizationId;
  const summaries = api.governanceKillSwitch.summaries.useQuery(
    { organizationId },
    { enabled: active, refetchOnWindowFocus: false },
  );
  const pending = api.governanceKillSwitch.pendingApprovals.useQuery(
    { organizationId },
    { enabled: active, refetchOnWindowFocus: false },
  );
  return {
    byRowId: summariesByRowId(active ? (summaries.data ?? []) : []),
    pendingApprovals: active ? (pending.data ?? []) : [],
  };
}

/** Every kill switch read a stop, a decision or a plan edit can change. */
export function useKillSwitchRefresh({ organizationId }: { organizationId: string }) {
  const utils = api.useUtils();
  return {
    afterStopChange: async () => {
      await Promise.all([
        utils.governanceKillSwitch.summaries.invalidate({ organizationId }),
        utils.governanceKillSwitch.pendingApprovals.invalidate({ organizationId }),
      ]);
    },
    afterPlanChange: async ({ agentId }: { agentId: string }) => {
      await Promise.all([
        utils.governanceKillSwitch.plan.invalidate({ organizationId, agentId }),
        utils.governanceKillSwitch.summaries.invalidate({ organizationId }),
      ]);
    },
    afterConnectionChange: async () => {
      await utils.governanceKillSwitch.awsConnections.invalidate({ organizationId });
    },
  };
}
