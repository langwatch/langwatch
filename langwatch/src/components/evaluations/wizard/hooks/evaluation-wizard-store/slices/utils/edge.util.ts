import { type Edge } from "@xyflow/react";

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
  source: string,
  target: string,
  sourceHandle = "outputs.output",
  targetHandle = "inputs.input"
): Edge => ({
  id: `${source}-to-${target}`,
  source,
  target,
  sourceHandle,
  targetHandle,
  type: "default",
});
