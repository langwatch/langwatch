import type { Edge, Node } from "@xyflow/react";
import type {
  AvailableSource,
  FieldMapping,
} from "~/components/variables";
import type { Component, Field } from "../types/dsl";

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

/**
 * Builds complete input mappings by reading both edges (source mappings)
 * and field.value (value mappings). Edge mappings take priority over
 * field.value when both exist for the same input.
 */
export function buildInputMappings({
  nodeId,
  edges,
  inputs,
}: {
  nodeId: string;
  edges: Edge[];
  inputs: Field[];
}): Record<string, FieldMapping> {
  const mappings: Record<string, FieldMapping> = {};

  // Source mappings from edges
  edges
    .filter((e) => e.target === nodeId)
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

  // Value mappings from field.value (for inputs without an edge)
  inputs.forEach((input) => {
    if (
      input.value != null &&
      input.value !== "" &&
      !mappings[input.identifier]
    ) {
      mappings[input.identifier] = {
        type: "value",
        value: String(input.value),
      };
    }
  });

  return mappings;
}

/**
 * Applies a mapping change for a single input field. Handles both source
 * mappings (creates/removes edges) and value mappings (sets/clears field.value).
 * Returns the updated edges and inputs arrays.
 */
export function applyMappingChange({
  nodeId,
  identifier,
  mapping,
  currentEdges,
  currentInputs,
}: {
  nodeId: string;
  identifier: string;
  mapping: FieldMapping | undefined;
  currentEdges: Edge[];
  currentInputs: Field[];
}): { edges: Edge[]; inputs: Field[] } {
  // Remove existing edge for this input
  const filteredEdges = currentEdges.filter(
    (edge) =>
      !(
        edge.target === nodeId &&
        edge.targetHandle === `inputs.${identifier}`
      ),
  );

  // Update field.value on the matching input
  const updatedInputs = currentInputs.map((input) => {
    if (input.identifier !== identifier) return input;
    if (mapping?.type === "value") {
      return { ...input, value: mapping.value };
    }
    // Clear value for source mapping or no mapping
    const { value: _value, ...rest } = input;
    return rest;
  });

  if (mapping?.type === "source") {
    const newEdge: Edge = {
      id: `edge-${identifier}-${Date.now()}`,
      source: mapping.sourceId,
      target: nodeId,
      sourceHandle: `outputs.${mapping.path.join(".")}`,
      targetHandle: `inputs.${identifier}`,
      type: "default",
    };
    return { edges: [...filteredEdges, newEdge], inputs: updatedInputs };
  }

  return { edges: filteredEdges, inputs: updatedInputs };
}
