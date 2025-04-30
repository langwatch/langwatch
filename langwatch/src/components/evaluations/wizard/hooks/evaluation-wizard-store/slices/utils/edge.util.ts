import { type Edge, type Node } from "@xyflow/react";
import type { Component, Entry } from "~/optimization_studio/types/dsl";

const createEdgeId = (source: string, target: string) =>
  `${source}-to-${target}`;

/**
 * Create a default edge between two nodes, with the assumption
 * that we're connecting the output of the source node to the input of the target node
 * @param source
 * @param target
 * @param sourceHandle
 * @param targetHandle
 * @returns
 */
export const createDefaultEdge = (
  edge: Partial<Edge> & Required<Pick<Edge, "source" | "target">>
): Edge => ({
  // Defaults
  id: createEdgeId(edge.source, edge.target),
  sourceHandle: "outputs.input",
  targetHandle: "inputs.input",
  type: "default",
  // Overrides
  ...edge,
});

/**
 * Create the default edge between the executor node and the evaluator node
 */
export const buildExecutorToEvaluatorEdge = (
  edge: Partial<Edge> & Required<Pick<Edge, "source" | "target">>
): Edge =>
  ({
    // Defaults
    id: createEdgeId(edge.source, edge.target),
    sourceHandle: "outputs.output",
    targetHandle: "inputs.output",
    type: "default",
    // Overrides
    ...edge,
  }) as Edge;

/**
 * Map of dataset field names to trace field names
 * This is used to infer the correct trace field name for a given dataset field name
 * since we don't know the exact field name provided by the user.
 */
const DATASET_INFERRED_MAPPINGS_BY_NAME: Record<string, string> = {
  trace_id: "trace_id",
  timestamp: "timestamp",
  input: "input",
  question: "input",
  user_input: "input",
  output: "output",
  answer: "output",
  response: "output",
  result: "output",
  expected_output: "output",
  total_cost: "metrics.total_cost",
  contexts: "contexts.string_list",
  spans: "spans",
};

/**
 * Create the transposed version of the mapping for bidirectional lookups.
 * This allows us to find all possible dataset field names that map to a specific trace field.
 *
 * @example
 * // Original mapping: { "question": "input", "user_input": "input" }
 * // Transposed result: { "input": ["question", "user_input"] }
 */
const DATASET_INFERRED_MAPPINGS_BY_NAME_TRANSPOSED = Object.entries(
  DATASET_INFERRED_MAPPINGS_BY_NAME
).reduce(
  (acc, [key, value]) => {
    if (acc[value]) {
      acc[value]!.push(key);
    } else {
      acc[value] = [key];
    }
    return acc;
  },
  {} as Record<string, string[]>
);

/**
 * Create default entry to target edges
 *
 * For all of the target inputs, we try to find the best
 * match from the source outputs based on the dataset inferred mappings.
 */
export const buildEntryToTargetEdges = (
  entryNode: Node<Entry> | undefined,
  targetNode: Node<Component> | undefined
): Edge[] => {
  const edges: Edge[] = [];

  // Skip if target node has no inputs or entry node has no outputs
  if (!targetNode?.data?.inputs || !entryNode?.data?.outputs) {
    return edges;
  }

  // For each input field in the target node, find a suitable source field
  targetNode.data.inputs.forEach((input) => {
    // Skip if not a field with identifier
    if (typeof input !== "object" || !("identifier" in input)) return;

    const inputIdentifier = input.identifier;

    // 1. Try direct match - same name
    const directMatch = entryNode.data.outputs?.find(
      (output) => output.identifier === inputIdentifier
    );

    if (directMatch) {
      edges.push({
        id: `${entryNode.id}-to-${targetNode.id}-${inputIdentifier}`,
        source: entryNode.id,
        sourceHandle: `outputs.${inputIdentifier}`,
        target: targetNode.id,
        targetHandle: `inputs.${inputIdentifier}`,
        type: "default",
      });
      return; // Found a match, move to next input
    }

    // 2. Try inferred matches using mappings
    // Get potential field names from the mappings
    const mappingKey = DATASET_INFERRED_MAPPINGS_BY_NAME[inputIdentifier];
    const potentialFields = mappingKey
      ? [
          // Put the direct mapping first so it's prioritized
          mappingKey,
          // Then try the transposed mappings
          ...(DATASET_INFERRED_MAPPINGS_BY_NAME_TRANSPOSED[mappingKey] ?? []),
        ]
      : [];

    // Check each potential field name
    for (const fieldName of potentialFields) {
      const match = entryNode.data.outputs?.find(
        (output) => output.identifier === fieldName
      );

      if (match) {
        edges.push({
          id: `${entryNode.id}-to-${targetNode.id}-${inputIdentifier}`,
          source: entryNode.id,
          sourceHandle: `outputs.${fieldName}`,
          target: targetNode.id,
          targetHandle: `inputs.${inputIdentifier}`,
          type: "default",
        });
        break; // Found a match, move to next input
      }
    }
  });

  return edges;
};
