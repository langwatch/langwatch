import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import type { Field } from "@langwatch/workflow-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";
import type { TargetConfig } from "../../model/experiments-v3/types";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store";

/**
 * The agent row this hook reads, named because the borrowed `agents.getAll`
 * entry in the workflow family's procedure map declares the PATH and leaves the
 * row to the caller.
 */
type AgentFieldsRow = {
  id: string;
  inputFields?: Field[];
  outputFields?: Field[];
  /** Whether the agent's workflow was read; false means "leave the column be". */
  fieldsResolved?: boolean;
};

type DerivedTargetFields = {
  targetId: string;
  inputFields: Field[];
  outputFields: Field[];
  fieldsResolved: boolean;
};

const isWorkflowAgentTarget = (target: TargetConfig): boolean =>
  target.type === "agent" && target.agentType === "workflow" && !!target.dbAgentId;

const sameFields = ({
  recorded,
  derived,
}: {
  recorded: Field[] | undefined;
  derived: Field[];
}): boolean =>
  (recorded ?? []).length === derived.length &&
  (recorded ?? []).every(
    (field, index) =>
      field.identifier === derived[index]?.identifier && field.type === derived[index]?.type,
  );

/**
 * The fields a target records that its workflow no longer agrees with, or undefined
 * when the two already match.
 */
const staleFields = ({
  target,
  derived,
}: {
  target: TargetConfig;
  derived: DerivedTargetFields;
}): Partial<Pick<TargetConfig, "inputs" | "outputs">> | undefined => {
  const { inputFields, outputFields, fieldsResolved } = derived;
  if (!fieldsResolved) return undefined;

  const updates: Partial<Pick<TargetConfig, "inputs" | "outputs">> = {};

  if (!sameFields({ recorded: target.inputs, derived: inputFields })) {
    updates.inputs = inputFields;
  }
  if (!sameFields({ recorded: target.outputs, derived: outputFields })) {
    updates.outputs = outputFields;
  }

  return Object.keys(updates).length > 0 ? updates : undefined;
};

/**
 * Keeps a workflow agent target's recorded fields in step with its workflow.
 */
export const useSyncWorkflowTargetFields = () => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const { targets, updateTarget } = useEvaluationsV3Store(
    useShallow((state) => ({
      targets: state.targets,
      updateTarget: state.updateTarget,
    })),
  );

  const workflowTargets = useMemo(() => targets.filter(isWorkflowAgentTarget), [targets]);

  // The project's agents, the same query the agent picker uses, so this
  // usually costs nothing beyond a cache read.
  const agentsQuery = api.agents.getAll.useQuery(
    { projectId },
    { enabled: !!projectId && workflowTargets.length > 0, staleTime: 60_000 },
  );

  // Serialized so the effect has one primitive dependency: only the resolved
  // contents matter, and the query object is new on every render.
  const derived = JSON.stringify(
    workflowTargets.map((target): DerivedTargetFields => {
      const agent = (agentsQuery.data as AgentFieldsRow[] | undefined)?.find(
        (a) => a.id === target.dbAgentId,
      );
      return {
        targetId: target.id,
        inputFields: agent?.inputFields ?? [],
        outputFields: agent?.outputFields ?? [],
        // An agent that is not in the list yet has not answered, which reads
        // the same as a workflow that could not be read: leave the column be.
        fieldsResolved: agent?.fieldsResolved ?? false,
      };
    }),
  );

  useEffect(() => {
    const targets = useEvaluationsV3Store.getState().targets;
    const pending = (JSON.parse(derived) as DerivedTargetFields[]).flatMap((fields) => {
      const target = targets.find((t) => t.id === fields.targetId);
      const updates = target ? staleFields({ target, derived: fields }) : undefined;
      return updates ? [{ targetId: fields.targetId, updates }] : [];
    });

    if (pending.length === 0) return;

    const temporal = useEvaluationsV3Store.temporal.getState();
    const wasTracking = temporal.isTracking;
    if (wasTracking) temporal.pause();
    try {
      for (const { targetId, updates } of pending) {
        updateTarget(targetId, updates);
      }
    } finally {
      if (wasTracking) temporal.resume();
    }
  }, [derived, updateTarget]);
};
