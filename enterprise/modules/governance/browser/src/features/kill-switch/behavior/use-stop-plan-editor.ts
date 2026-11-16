// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * An agent's stop plan as a draft: what it reads, the edits, and the save that replaces the
 * plan whole. Nothing is editable or saved until the plan read succeeded, so a failed read can
 * never save an empty plan. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import {
  type AgentStopTarget,
  DATABRICKS_GENIE_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { describeStopTarget } from "../model/kill-switch-copy.ts";
import { useKillSwitchRefresh } from "./use-kill-switch.ts";

export function useStopPlanEditor({
  organizationId,
  agentId,
  open,
}: {
  organizationId: string;
  agentId: string;
  open: boolean;
}) {
  const [draft, setDraft] = useState<AgentStopTarget[] | null>(null);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const reads = { enabled: open && !!organizationId, refetchOnWindowFocus: false };
  const plan = api.governanceKillSwitch.plan.useQuery({ organizationId, agentId }, reads);
  const connections = api.governanceKillSwitch.awsConnections.useQuery({ organizationId }, reads);
  const sources = api.governanceAgents.syncSources.useQuery({ organizationId }, reads);
  const save = api.governanceKillSwitch.setPlan.useMutation();

  const loaded = plan.data !== undefined && !plan.isError;
  const saved = loaded ? plan.data.targets : [];
  const targets = draft ?? saved.map((row) => row.target);
  const labelOf = (target: AgentStopTarget) =>
    saved.find((row) => JSON.stringify(row.target) === JSON.stringify(target))?.label ??
    describeStopTarget(target);

  /** Resolves true once the plan was saved. */
  const submit = async (): Promise<boolean> => {
    if (!loaded || save.isPending) return false;
    try {
      await save.mutateAsync({ organizationId, agentId, targets });
      toaster.create({ title: "Stop plan saved", type: "success" });
      await refresh.afterPlanChange({ agentId });
      setDraft(null);
      return true;
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't save the stop plan" });
      return false;
    }
  };

  return {
    loaded,
    isLoading: plan.isPending && !plan.isError,
    error: loaded ? null : plan.error,
    retry: () => void plan.refetch(),
    targets,
    labelOf,
    setTargets: (next: AgentStopTarget[]) => setDraft(next),
    discard: () => setDraft(null),
    submit,
    isSaving: save.isPending,
    databricksSources: (sources.data ?? [])
      .filter((source) => source.sourceType === DATABRICKS_GENIE_ADAPTER_ID)
      .map((source) => ({ value: source.id, label: source.name })),
    awsConnections: connections.data ?? [],
  };
}
