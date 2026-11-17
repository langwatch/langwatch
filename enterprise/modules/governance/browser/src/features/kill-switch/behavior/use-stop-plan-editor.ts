// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * An agent's stop plan as a draft: what it reads, the edits, and the save that replaces the
 * plan whole. Nothing is editable or saved until the plan read succeeded, so a failed read can
 * never save an empty plan; nothing is editable while a save and its re-read run, so no edit is
 * lost when the draft clears. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import {
  type AgentStopTarget,
  DATABRICKS_GENIE_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { describeStopTarget } from "../model/kill-switch-copy.ts";
import { readFailureOf, useKillSwitchRefresh } from "./use-kill-switch.ts";

/** A lookup that failed with nothing to show: its error and retry, never an empty list. */
function lookupFailure(read: {
  data?: unknown;
  error: unknown;
  failureReason?: unknown;
  refetch: () => unknown;
}) {
  const failure = readFailureOf(read);
  if (read.data !== undefined || !failure) return null;
  return { error: failure, retry: () => void read.refetch() };
}

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
  const [submitting, setSubmitting] = useState(false);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const reads = { enabled: open && !!organizationId, refetchOnWindowFocus: false };
  const plan = api.governanceKillSwitch.plan.useQuery({ organizationId, agentId }, reads);
  const connections = api.governanceKillSwitch.awsConnections.useQuery({ organizationId }, reads);
  const sources = api.governanceAgents.syncSources.useQuery({ organizationId }, reads);
  const save = api.governanceKillSwitch.setPlan.useMutation();

  const planFailure = readFailureOf(plan);
  const loaded = plan.data !== undefined && !planFailure;
  const saved = loaded ? plan.data.targets : [];
  const targets = draft ?? saved.map((row) => row.target);
  const labelOf = (target: AgentStopTarget) =>
    saved.find((row) => JSON.stringify(row.target) === JSON.stringify(target))?.label ??
    describeStopTarget(target);

  const isSaving = save.isPending || submitting;
  /** Resolves true once the plan was saved and read again. */
  const submit = async (): Promise<boolean> => {
    if (!loaded || isSaving) return false;
    setSubmitting(true);
    try {
      await save.mutateAsync({ organizationId, agentId, targets });
      toaster.create({ title: "Stop plan saved", type: "success" });
      await refresh.afterPlanChange({ agentId });
      setDraft(null);
      return true;
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't save the stop plan" });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    loaded,
    isLoading: plan.isPending && !planFailure,
    error: loaded ? null : planFailure,
    retry: () => void plan.refetch(),
    targets,
    labelOf,
    setTargets: (next: AgentStopTarget[]) => setDraft((current) => (isSaving ? current : next)),
    discard: () => setDraft(null),
    submit,
    isSaving,
    sourcesFailure: lookupFailure(sources),
    connectionsFailure: lookupFailure(connections),
    databricksSources: (sources.data ?? [])
      .filter((source) => source.sourceType === DATABRICKS_GENIE_ADAPTER_ID)
      .map((source) => ({ value: source.id, label: source.name })),
    awsConnections: connections.data ?? [],
  };
}
