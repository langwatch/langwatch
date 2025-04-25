import type { Node, Edge } from "@xyflow/react";
import { camelCaseToSnakeCase } from "../../utils/stringCasing";

export const nameToId = (name: string) => {
  return camelCaseToSnakeCase(name)
    .replace(/[\(\)]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
};

export const findLowestAvailableName = (nodes: Node[], prefix: string) => {
  const findNode = (id: string) => {
    return nodes.find((node) => node.id === id);
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

export const getEntryInputs = (edges: Edge[], nodes: Node[]) => {
  const entryEdges = edges.filter((edge: Edge) => edge.source === "entry");
  const evaluators = nodes.filter(checkIsEvaluator);

  const entryInputs = entryEdges.filter(
    (edge: Edge, index, self) =>
      !evaluators?.some((evaluator: Node) => evaluator.id === edge.target) &&
      self.findIndex((e) => e.sourceHandle === edge.sourceHandle) === index
  );

  return entryInputs;
};

export const getInputsOutputs = (edges: Edge[], nodes: Node[]) => {
  const entryInputs = getEntryInputs(edges, nodes);

  const inputs = entryInputs.map((edge: Edge) => {
    return {
      identifier: edge.sourceHandle?.split(".")[1],
      type: "str",
    };
  });

  const outputs = nodes.find(
    (node: Node) => node.type === "end" || node.id === "end"
  )?.data.inputs;

  return { inputs, outputs };
};

export const checkIsEvaluator = (node: Node) => {
  return node.type === "evaluator" || node.data.behave_as === "evaluator";
};
