import type { AgentFields, Field } from "@langwatch/agent-contract";
import {
  getMappingSurfaceInputs,
  getWorkflowEndInputs,
  parseStudioWorkflow,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";

/**
 * What a workflow agent reads and produces, derived from the graph it points
 * at rather than stored on the agent.
 *
 * A workflow agent has no saved field list: it is a pointer to a Studio graph,
 * so the only record of its shape is that graph's entry and end nodes. The
 * derivation runs on every read, because copying the shape onto the agent
 * would let an edit to the graph leave the agent describing a shape the
 * workflow no longer has.
 *
 * A graph that cannot be read reports NO fields and `fieldsResolved: false`.
 * The alternative — inventing a single field named "output" — is what made a
 * two-result workflow look like it produced one text field, and a caller that
 * cannot tell "unknown" from "one output" has no way to avoid repeating that.
 */
export function linkedWorkflowFields(dsl: unknown): AgentFields {
  const graph = tryParseGraph(dsl);
  if (!graph?.nodes) {
    return { inputFields: [], outputFields: [], fieldsResolved: false };
  }

  const inputFields = getMappingSurfaceInputs(graph.edges ?? [], graph.nodes).map((input) => ({
    identifier: input.identifier,
    type: input.type,
    ...(input.optional ? { optional: true } : {}),
  }));

  const outputFields = getWorkflowEndInputs(graph).map((output) => ({
    identifier: output.identifier,
    type: output.type as Field["type"],
  }));

  return { inputFields, outputFields, fieldsResolved: true };
}

/**
 * A stored `dsl` column is untrusted JSON, and a version written by an older
 * Studio can fail today's refinement. That is the same fact as "the graph
 * could not be read", so it answers the same way rather than failing the whole
 * agent list because one of its agents points at a graph we cannot parse.
 */
function tryParseGraph(dsl: unknown): StudioWorkflow | undefined {
  if (dsl === null || dsl === undefined) return undefined;
  try {
    return parseStudioWorkflow(dsl);
  } catch {
    return undefined;
  }
}
