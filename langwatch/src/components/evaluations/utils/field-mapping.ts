import type { Edge, Node } from "@xyflow/react";
import type {
  Workflow,
  Component,
  Field as DSLField,
  Evaluator,
} from "~/optimization_studio/types/dsl";

// Copy the mappings from TracesMapping.tsx for reuse
export const DATASET_INFERRED_MAPPINGS_BY_NAME: Record<string, string> = {
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
export const DATASET_INFERRED_MAPPINGS_BY_NAME_TRANSPOSED = Object.entries(
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
 * Checks if an input field is already connected to a source
 */
function isFieldAlreadyConnected(
  workflow: Workflow,
  targetNodeId: string,
  inputIdentifier: string
): boolean {
  return workflow.edges.some(
    (edge) =>
      edge.target === targetNodeId &&
      edge.targetHandle === `inputs.${inputIdentifier}`
  );
}

/**
 * Finds a direct match for an input field in a source node
 */
function findDirectMatch(
  sourceNode: Node<Component>,
  inputIdentifier: string
): DSLField | undefined {
  return sourceNode.data.outputs?.find(
    (output) => output.identifier === inputIdentifier
  );
}

/**
 * Creates an edge between a source and target node
 */
function createEdge(
  sourceNode: Node<Component>,
  targetNode: Node<Component>,
  sourceField: string,
  targetField: string
): Edge {
  return {
    id: `${sourceNode.id}-to-${targetNode.id}-${targetField}`,
    source: sourceNode.id,
    sourceHandle: `outputs.${sourceField}`,
    target: targetNode.id,
    targetHandle: `inputs.${targetField}`,
    type: "default",
  };
}

/**
 * Gets potential field names that could match an input identifier
 */
function getPotentialFieldNames(inputIdentifier: string): string[] {
  const mappingKey = DATASET_INFERRED_MAPPINGS_BY_NAME[inputIdentifier];
  return mappingKey
    ? [
        mappingKey,
        ...(DATASET_INFERRED_MAPPINGS_BY_NAME_TRANSPOSED[mappingKey] ?? []),
      ]
    : [];
}

/**
 * Creates edges between source nodes and target nodes based on field mappings
 * Supports both direct and inferred field connections
 */
export function createFieldMappingEdges(
  workflow: Workflow,
  targetNode: Node<Component>,
  sourceNodeTypes: string[] = ["entry"]
): Edge[] {
  const edges: Edge[] = [];

  // Get source nodes of the specified types
  const sourceNodes = workflow.nodes
    .filter((node) => node.type && sourceNodeTypes.includes(node.type))
    .reverse();

  // Skip if there are no source nodes or target node has no inputs
  if (sourceNodes.length === 0 || !targetNode.data.inputs) {
    return edges;
  }

  // For each input field in the target node, find a suitable source field
  targetNode.data.inputs.forEach((input: DSLField) => {
    // Skip if not a field with identifier
    if (typeof input !== "object" || !("identifier" in input)) return;

    const inputIdentifier = input.identifier;

    // Skip if already connected
    if (isFieldAlreadyConnected(workflow, targetNode.id, inputIdentifier)) {
      return;
    }

    // Try to find a matching field in source nodes
    for (const sourceNode of sourceNodes) {
      if (!sourceNode.data.outputs) continue;

      // 1. Try direct match - same name
      const directMatch = findDirectMatch(sourceNode, inputIdentifier);
      if (directMatch) {
        edges.push(
          createEdge(sourceNode, targetNode, inputIdentifier, inputIdentifier)
        );
        break; // Found a match, move to next input
      }

      // 2. Try inferred matches using mappings
      const potentialFields = getPotentialFieldNames(inputIdentifier);

      // Check each potential field name
      for (const fieldName of potentialFields) {
        const match = sourceNode.data.outputs.find(
          (output) => output.identifier === fieldName
        );

        if (match) {
          edges.push(
            createEdge(sourceNode, targetNode, fieldName, inputIdentifier)
          );
          break; // Found a match, try the next source node
        }
      }
    }
  });

  return edges;
}

/**
 * Specialized function for connecting evaluator nodes to their required dataset fields
 * This is particularly useful for the evaluation wizard
 */
export function connectEvaluatorFields(
  workflow: Workflow,
  evaluatorNode: Node<Evaluator>
): Edge[] {
  // For evaluators, we prioritize certain key fields like contexts
  const priorityFields = [
    "contexts",
    "input",
    "output",
    "expected_output",
    "expected_contexts",
  ];

  const edges = createFieldMappingEdges(workflow, evaluatorNode);

  // Check if any priority fields are missing connections
  const connectedFields = new Set(
    edges.map((edge) => edge.targetHandle?.split(".")[1])
  );

  const missingPriorityFields = priorityFields.filter(
    (field) =>
      evaluatorNode.data.inputs?.some(
        (input) => "identifier" in input && input.identifier === field
      ) && !connectedFields.has(field)
  );

  // If there are missing priority fields, log a warning
  if (missingPriorityFields.length > 0) {
    console.warn(
      `Could not find matching fields for evaluator ${
        evaluatorNode.id
      } fields: ${missingPriorityFields.join(", ")}`
    );
  }

  return edges;
}
