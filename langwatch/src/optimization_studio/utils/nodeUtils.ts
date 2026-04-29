import type { Edge, Node } from "@xyflow/react";
import { camelCaseToSnakeCase } from "../../utils/stringCasing";

/**
 * Validates a node name for rename operations.
 * Returns `{ valid: true }` or `{ valid: false, error: string }`.
 */
export const validateNodeName = ({
  name,
  currentNodeId,
  existingNodeIds,
}: {
  name: string;
  currentNodeId: string;
  existingNodeIds: string[];
}): { valid: true } | { valid: false; error: string } => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Name cannot be empty" };
  }

  const withUnderscores = trimmed.replace(/ /g, "_");

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(withUnderscores)) {
    return { valid: false, error: "Name must be a valid Python identifier" };
  }

  const newId = nameToId(trimmed);
  if (existingNodeIds.some((id) => id !== currentNodeId && id === newId)) {
    return { valid: false, error: "A node with this name already exists" };
  }

  return { valid: true };
};

export const nameToId = (name: string) => {
  return camelCaseToSnakeCase(name)
    .replace(/[\(\)]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
    .replace(/[^a-zA-Z0-9_]/g, "_");
};

export const findLowestAvailableName = (nodesIds: string[], prefix: string) => {
  const findNode = (id: string) => {
    return nodesIds.find((nodeId) => nodeId === id);
  };

  let i = 1;
  let name;
  let id;
  do {
    if (i === 1) {
      name = prefix;
    } else {
      name = `${prefix} (${i})`;
    }
    id = nameToId(name);
    i++;
  } while (findNode(id));

  return { name, id };
};

export const getEntryInputs = (
  edges: Edge[],
  nodes: Node[],
): (Edge & { optional?: boolean })[] => {
  const entryEdges = edges.filter((edge: Edge) => edge.source === "entry");
  const evaluators = nodes.filter(checkIsEvaluator);

  const entryInputs = entryEdges
    .filter(
      (edge: Edge, index, self) =>
        self.findIndex((e) => e.sourceHandle === edge.sourceHandle) === index,
    )
    .map((edge: Edge) => {
      if (
        !evaluators?.some((evaluator: Node) => evaluator.id === edge.target)
      ) {
        return edge;
      }
      return {
        ...edge,
        optional: true,
      };
    });

  return entryInputs;
};

export const getInputsOutputs = (edges: Edge[], nodes: Node[]) => {
  const entryInputs = getEntryInputs(edges, nodes);

  const inputs = entryInputs.map((edge) => {
    return {
      identifier: edge.sourceHandle?.split(".")[1],
      type: "str",
      ...(edge.optional ? { optional: true } : {}),
    };
  });

  const outputs = nodes.find(
    (node: Node) => node.type === "end" || node.id === "end",
  )?.data.inputs;

  return { inputs, outputs };
};

export const checkIsEvaluator = (node: Node) => {
  return node.type === "evaluator" || node.data.behave_as === "evaluator";
};
