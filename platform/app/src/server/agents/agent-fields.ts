import {
  linkedWorkflowId as getLinkedWorkflowId,
  type AgentConfig as AgentComponentConfig,
  type AgentFields as ContractAgentFields,
  type AgentType,
  type AgentWithFields as ContractAgentWithFields,
} from "@langwatch/agent-contract";
import type { Field, StudioWorkflow } from "@langwatch/workflow-contract";
import { getMappingSurfaceInputs } from "@langwatch/workflow-contract";
import { getWorkflowEndInputs } from "@langwatch/workflow-contract";

/**
 * The fields an agent reads and produces, whatever kind of agent it is.
 *
 * Code, signature and HTTP agents keep these on their own saved config. A
 * workflow agent does not: it is a pointer to a Studio graph, so the only
 * record of what it reads and produces is that graph's entry and end nodes.
 * Consumers should not have to know which kind they are holding, so this is
 * resolved for every agent at read time.
 */
export type AgentFields = ContractAgentFields;

/**
 * What every read of an agent hands back: the row plus the fields it reads and
 * produces. Callers pick an agent from a list and immediately need its shape,
 * so the two always travel together.
 */
export type AgentWithFields = ContractAgentWithFields;

/**
 * Compatibility export for app-only callers. The canonical fallback logic
 * lives in the portable Agents contract so server and browser consumers agree.
 * The `workflowId` column is authoritative, with a legacy `workflow_id`
 * config fallback for agents created before the column existed.
 */
export const linkedWorkflowId = getLinkedWorkflowId;

/**
 * A workflow's inputs are its entry node's mapping surface, and its outputs
 * are its end node's inputs — what the Studio labels RESULTS.
 *
 * Derived on every read rather than copied onto the agent, because the graph
 * is the source of truth and editing it must not leave the agent describing a
 * shape the workflow no longer has.
 */
export const workflowAgentFields = (
  dsl: StudioWorkflow | undefined | null,
): AgentFields => {
  if (!dsl?.nodes) {
    return { inputFields: [], outputFields: [], fieldsResolved: false };
  }

  const inputFields = getMappingSurfaceInputs(dsl.edges ?? [], dsl.nodes).map(
    (input) => ({
      identifier: input.identifier,
      type: input.type,
      ...(input.optional ? { optional: true } : {}),
    }),
  );

  const outputFields = getWorkflowEndInputs(dsl).map((output) => ({
    identifier: output.identifier,
    type: output.type as Field["type"],
  }));

  return { inputFields, outputFields, fieldsResolved: true };
};

/**
 * Resolve an agent's fields.
 *
 * `dsl` is only consulted for workflow agents, and only the caller can load it
 * (it lives on a different table), so it arrives as an argument rather than
 * being fetched here.
 *
 * A workflow agent whose graph could not be read reports no fields and
 * `fieldsResolved: false`. The alternative, inventing a single field named
 * "output", is what made a two-result workflow look like it produced one text
 * field, and a caller that cannot tell "unknown" from "one output" has no way
 * to avoid repeating that.
 */
export const resolveAgentFields = ({
  type,
  config,
  dsl,
}: {
  type: AgentType;
  config: AgentComponentConfig;
  dsl?: StudioWorkflow | null;
}): AgentFields => {
  if (type === "workflow") return workflowAgentFields(dsl);

  return {
    inputFields: config.inputs ?? [],
    outputFields: config.outputs ?? [],
    fieldsResolved: true,
  };
};
