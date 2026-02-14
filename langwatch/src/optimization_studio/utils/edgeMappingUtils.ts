import type { Edge, Node } from "@xyflow/react";
import type {
  AvailableSource,
  FieldMapping,
} from "~/components/variables";
import type { Component } from "../types/dsl";

/**
 * Builds available sources for variable mapping from the workflow graph.
 * Excludes downstream nodes (to prevent cycles) and the "end" node.
 */
export function buildAvailableSources({
  nodeId,
  nodes,
  edges,
}: {
  nodeId: string;
  nodes: Node<Component>[];
  edges: Edge[];
}): AvailableSource[] {
  const downstreamNodes = new Set<string>();
  const toVisit = [nodeId];
  while (toVisit.length > 0) {
    const currentNode = toVisit.shift();
    if (!currentNode) continue;
    downstreamNodes.add(currentNode);
    toVisit.push(
      ...edges
        .filter((edge) => edge.source === currentNode)
        .map((edge) => edge.target),
    );
  }

  return nodes
    .filter((n) => !downstreamNodes.has(n.id) && n.id !== "end")
    .map((n) => {
      const isEntry = n.type === "entry";
      const entryDataset = isEntry
        ? (n.data as { dataset?: { name?: string } }).dataset
        : undefined;
      return {
        id: n.id,
        name: isEntry
          ? (entryDataset?.name ?? "Dataset")
          : (n.data.name ?? n.id),
        type: isEntry ? "dataset" : (n.type as AvailableSource["type"]),
        fields:
          n.data.outputs?.map((output) => ({
            name: output.identifier,
            type: output.type,
          })) ?? [],
      };
    })
    .filter((source) => source.fields.length > 0);
}

/**
 * Builds input mappings from edges targeting the given node.
 * Parses edge handles to extract input identifiers and source fields.
 */
export function buildInputMappingsFromEdges({
  nodeId,
  edges,
}: {
  nodeId: string;
  edges: Edge[];
}): Record<string, FieldMapping> {
  const mappings: Record<string, FieldMapping> = {};
  edges
    .filter((edge) => edge.target === nodeId)
    .forEach((edge) => {
      const targetHandle = edge.targetHandle?.split(".")[1];
      const sourceField = edge.sourceHandle?.split(".")[1];
      if (targetHandle && sourceField && edge.source) {
        mappings[targetHandle] = {
          type: "source",
          sourceId: edge.source,
          path: [sourceField],
        };
      }
    });
  return mappings;
}

/**
 * Applies a mapping change to the edge list.
 * Removes existing edges for the input and optionally adds a new edge.
 * Returns the updated edge array.
 */
export function applyMappingChangeToEdges({
  nodeId,
  identifier,
  mapping,
  currentEdges,
}: {
  nodeId: string;
  identifier: string;
  mapping: FieldMapping | undefined;
  currentEdges: Edge[];
}): Edge[] {
  // Remove existing edge for this input
  const filteredEdges = currentEdges.filter(
    (edge) =>
      !(
        edge.target === nodeId &&
        edge.targetHandle === `inputs.${identifier}`
      ),
  );

  if (mapping && mapping.type === "source") {
    const newEdge: Edge = {
      id: `edge-${identifier}-${Date.now()}`,
      source: mapping.sourceId,
      target: nodeId,
      sourceHandle: `outputs.${mapping.path.join(".")}`,
      targetHandle: `inputs.${identifier}`,
      type: "default",
    };
    return [...filteredEdges, newEdge];
  }

  return filteredEdges;
}
