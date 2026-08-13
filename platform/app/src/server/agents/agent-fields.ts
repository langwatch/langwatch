import type { Field, Workflow } from "~/optimization_studio/types/dsl";
import { getMappingSurfaceInputs } from "~/optimization_studio/utils/nodeUtils";
import { getWorkflowEndInputs } from "~/optimization_studio/utils/workflowFields";
import type {
  AgentComponentConfig,
  AgentType,
  TypedAgent,
} from "./agent.repository";

/**
 * The fields an agent reads and produces, whatever kind of agent it is.
 *
 * Code, signature and HTTP agents keep these on their own saved config. A
 * workflow agent does not: it is a pointer to a Studio graph, so the only
 * record of what it reads and produces is that graph's entry and end nodes.
 * Consumers should not have to know which kind they are holding, so this is
 * resolved for every agent at read time.
 */
export type AgentFields = {
  inputFields: Field[];
  outputFields: Field[];
  /**
   * Whether the two lists above are what the agent actually declares.
   *
   * `false` only for a workflow agent whose graph could not be read — archived,
   * deleted, or in another project. That is not the same as a workflow that
   * declares no results, and a caller that cannot tell the two apart has to
   * pick one wrong behaviour for both: either wipe a column's mappings the
   * first time a lookup fails, or keep offering a result that was removed.
   */
  fieldsResolved: boolean;
};

/**
 * What every read of an agent hands back: the row plus the fields it reads and
 * produces. Callers pick an agent from a list and immediately need its shape,
 * so the two always travel together.
 */
export type AgentWithFields = TypedAgent & AgentFields;

/**
 * The Studio workflow a workflow agent points at.
 *
 * The `workflowId` column is authoritative, but agents created before it
 * existed only carry `workflow_id` inside their DSL config, and the two
 * drawers that read this already disagreed about which to try first.
 */
export const linkedWorkflowId = (agent: {
  workflowId?: string | null;
  config: AgentComponentConfig;
}): string | undefined => {
  if (agent.workflowId) return agent.workflowId;
  const config = agent.config as { workflow_id?: string };
  return config.workflow_id;
};

/**
 * A workflow's inputs are its entry node's mapping surface, and its outputs
 * are its end node's inputs — what the Studio labels RESULTS.
 *
 * Derived on every read rather than copied onto the agent, because the graph
 * is the source of truth and editing it must not leave the agent describing a
 * shape the workflow no longer has.
 */
export const workflowAgentFields = (
  dsl: Workflow | undefined | null,
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
  dsl?: Workflow | null;
}): AgentFields => {
  if (type === "workflow") return workflowAgentFields(dsl);

  return {
    inputFields: config.inputs ?? [],
    outputFields: config.outputs ?? [],
    fieldsResolved: true,
  };
};
