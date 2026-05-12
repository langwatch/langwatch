import type { Edge, Node } from "@xyflow/react";
import { camelCaseToSnakeCase } from "../../utils/stringCasing";

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

/**
 * Derives mappable entry inputs from the entry node's declared outputs,
 * overlaying the optional flag based on edge connectivity.
 *
 * A declared output is marked optional when every downstream edge from that
 * output leads exclusively to evaluator nodes. Declared outputs with no edges
 * (unwired) are included without the optional flag — they are real workflow
 * inputs that simply haven't been connected yet.
 *
 * Falls back to edge-based derivation (same as getEntryInputs) when the entry
 * node is absent or declares no outputs, preserving backwards compatibility
 * with DSLs that omit the entry node entirely.
 */
export const getDeclaredEntryInputs = (
  edges: Edge[],
  nodes: Node[],
): Array<{ identifier: string; type: string; optional?: boolean }> => {
  const entryNode = nodes.find(
    (node: Node) => node.type === "entry" || node.id === "entry",
  );
  const declaredOutputs: Array<{ identifier: string; type: string }> =
    Array.isArray(entryNode?.data?.outputs) ? entryNode.data.outputs : [];

  if (declaredOutputs.length === 0) {
    // Fall back to edge-based derivation for DSLs without a declared entry node
    return getEntryInputs(edges, nodes).map((edge) => ({
      identifier: edge.sourceHandle?.split(".")[1] ?? "",
      type: "str",
      ...(edge.optional ? { optional: true } : {}),
    }));
  }

  const evaluators = nodes.filter(checkIsEvaluator);
  const evaluatorIds = new Set(evaluators.map((e: Node) => e.id));

  return declaredOutputs.map(({ identifier, type }) => {
    const fieldEdges = edges.filter(
      (edge: Edge) =>
        edge.source === "entry" &&
        edge.sourceHandle === `outputs.${identifier}`,
    );

    const hasNonEvaluatorTarget =
      fieldEdges.length > 0 &&
      fieldEdges.some((edge: Edge) => !evaluatorIds.has(edge.target));

    const evaluatorOnly =
      fieldEdges.length > 0 && !hasNonEvaluatorTarget;

    return {
      identifier,
      type: typeof type === "string" ? type : "str",
      ...(evaluatorOnly ? { optional: true } : {}),
    };
  });
};

export const getInputsOutputs = (edges: Edge[], nodes: Node[]) => {
  const inputs = getDeclaredEntryInputs(edges, nodes);

  const outputs = nodes.find(
    (node: Node) => node.type === "end" || node.id === "end",
  )?.data.inputs;

  return { inputs, outputs };
};

export const checkIsEvaluator = (node: Node) => {
  return node.type === "evaluator" || node.data.behave_as === "evaluator";
};
