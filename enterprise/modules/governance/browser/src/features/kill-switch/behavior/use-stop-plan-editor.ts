// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * An agent's stop plan as a draft, saved whole over the version it was read at (a newer save is
 * shown instead). Nothing is editable or saved until the plan read succeeded, so a failed read
 * never saves an empty plan, and nothing while a save and its re-read run, so no edit is lost.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import {
  type AgentStopPlanTarget,
  type AgentStopTarget,
  DATABRICKS_GENIE_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { describeStopTarget } from "../model/kill-switch-copy.ts";
import { readFailureOf, useKillSwitchRefresh } from "./use-kill-switch.ts";

const PLAN_CONFLICT = "agent_stop_plan_conflict";

/** A target's saved label, or a description of it for a target the draft added. */
function savedLabelOf({
  saved,
  target,
}: {
  saved: readonly AgentStopPlanTarget[];
  target: AgentStopTarget;
}): string {
  const key = JSON.stringify(target);
  return (
    saved.find((row) => JSON.stringify(row.target) === key)?.label ?? describeStopTarget(target)
  );
}

function databricksOptionsOf(sources: readonly { id: string; name: string; sourceType: string }[]) {
  return sources
    .filter((source) => source.sourceType === DATABRICKS_GENIE_ADAPTER_ID)
    .map((source) => ({ value: source.id, label: source.name }));
}

type SaveResult = { outcome: "saved" } | { outcome: "conflict" | "failed"; error: unknown };

/** A save's outcome; a conflict means someone else saved the plan since it was read. */
async function attemptSave(save: () => Promise<unknown>): Promise<SaveResult> {
  try {
    await save();
    return { outcome: "saved" };
  } catch (error) {
    const conflict = readHandledError(error)?.code === PLAN_CONFLICT;
    return { outcome: conflict ? "conflict" : "failed", error };
  }
}

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

/** The save of a plan over the version it was read at, and the re-read it ends with. */
function useStopPlanSave({ organizationId, agentId }: { organizationId: string; agentId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<unknown>(null);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const save = api.governanceKillSwitch.setPlan.useMutation();
  const isSaving = save.isPending || submitting;

  /** Resolves true once saved; `onReread` runs after the plan read again, saved or conflicted. */
  const submit = async ({
    targets,
    expectedVersion,
    onReread,
  }: {
    targets: AgentStopTarget[];
    expectedVersion: number;
    onReread: () => void;
  }): Promise<boolean> => {
    if (isSaving) return false;
    setSubmitting(true);
    setConflict(null);
    try {
      const result = await attemptSave(() =>
        save.mutateAsync({ organizationId, agentId, targets, expectedVersion }),
      );
      if (result.outcome === "failed") {
        showErrorToast({ error: result.error, fallbackTitle: "Couldn't save the stop plan" });
        return false;
      }
      if (result.outcome === "conflict") setConflict(result.error);
      else toaster.create({ title: "Stop plan saved", type: "success" });
      await refresh.afterPlanChange({ agentId });
      onReread();
      return result.outcome === "saved";
    } finally {
      setSubmitting(false);
    }
  };

  return { submit, isSaving, conflict, clearConflict: () => setConflict(null) };
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
  const reads = { enabled: open && !!organizationId, refetchOnWindowFocus: false };
  const plan = api.governanceKillSwitch.plan.useQuery({ organizationId, agentId }, reads);
  const connections = api.governanceKillSwitch.awsConnections.useQuery({ organizationId }, reads);
  const sources = api.governanceAgents.syncSources.useQuery({ organizationId }, reads);
  const saving = useStopPlanSave({ organizationId, agentId });

  const planFailure = readFailureOf(plan);
  const loaded = plan.data !== undefined && !planFailure;
  const saved = loaded ? plan.data.targets : [];
  const targets = draft ?? saved.map((row) => row.target);
  const labelOf = (target: AgentStopTarget) => savedLabelOf({ saved, target });
  const isSaving = saving.isSaving;

  /** Resolves true once the plan was saved and read again; a conflict reads the newer plan. */
  const submit = async (): Promise<boolean> => {
    if (!loaded) return false;
    return saving.submit({
      targets,
      expectedVersion: plan.data?.version ?? 0,
      onReread: () => setDraft(null),
    });
  };

  return {
    loaded,
    isLoading: plan.isPending && !planFailure,
    error: loaded ? null : planFailure,
    retry: () => void plan.refetch(),
    targets,
    labelOf,
    setTargets: (next: AgentStopTarget[]) => setDraft((current) => (isSaving ? current : next)),
    discard: () => {
      setDraft(null);
      saving.clearConflict();
    },
    submit,
    /** Set when someone else saved the plan first; the editor then shows their plan. */
    conflict: saving.conflict,
    isSaving,
    sourcesFailure: lookupFailure(sources),
    connectionsFailure: lookupFailure(connections),
    databricksSources: databricksOptionsOf(sources.data ?? []),
    awsConnections: connections.data ?? [],
  };
}
