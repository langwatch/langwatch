import type { Node, Edge } from "@xyflow/react";
import type { Workflow, Entry, Component } from "../types/dsl";
import { checkIsEvaluator } from "./nodeUtils";

/**
 * Field definition extracted from a workflow entry node
 */
export interface WorkflowField {
  identifier: string;
  type: string;
}

/**
 * Check if an entry output is connected to at least one non-evaluator node.
 * Only outputs that feed into non-evaluator nodes (LLM, code, etc.) should
 * be included in required field mappings.
 *
 * Outputs that are:
 * - Not connected to anything → excluded (not used by workflow)
 * - Only connected to evaluator nodes → excluded (evaluator-only inputs)
 * - Connected to at least one non-evaluator → included
 *
 * @param outputIdentifier - The identifier of the entry output
 * @param edges - The workflow edges
 * @param nodes - The workflow nodes
 * @returns True if the output is connected to at least one non-evaluator node
 */
export function isOutputConnectedToNonEvaluator(
  outputIdentifier: string,
  edges: Edge[],
  nodes: Node<Component>[],
): boolean {
  // Find all edges that come from this entry output
  // Entry output handles follow the pattern "outputs.{identifier}"
  const outputHandle = `outputs.${outputIdentifier}`;
  const outputEdges = edges.filter(
    (edge) => edge.source === "entry" && edge.sourceHandle === outputHandle,
  );

  // If there are no edges from this output, it's not used by the workflow
  if (outputEdges.length === 0) {
    return false;
  }

  // Check if ANY target node is a non-evaluator
  return outputEdges.some((edge) => {
    const targetNode = nodes.find((node) => node.id === edge.target);
    return targetNode && !checkIsEvaluator(targetNode);
  });
}

/**
 * Extract entry node outputs from a workflow DSL.
 * These represent the fields that can be mapped to trace data when
 * using the workflow as an evaluator.
 *
 * Outputs that only connect to evaluator nodes are excluded since
 * evaluators are optional processing nodes and their inputs don't
 * need to be mapped from trace data.
 *
 * @param workflow - The workflow DSL object
 * @returns Array of field definitions from the entry node outputs
 */
export function getWorkflowEntryOutputs(
  workflow: Workflow | null | undefined,
): WorkflowField[] {
  if (!workflow?.nodes) {
    return [];
  }

  // Find the entry node
  const entryNode = workflow.nodes.find((node) => node.type === "entry");

  if (!entryNode) {
    return [];
  }

  // Extract outputs from the entry node data
  const entryData = entryNode.data as Entry;
  const outputs = entryData?.outputs;

  if (!outputs || !Array.isArray(outputs)) {
    return [];
  }

  // Filter to only include outputs connected to non-evaluator nodes
  // This excludes:
  // - Outputs not connected to anything (unused)
  // - Outputs only connected to evaluator nodes (evaluator-only inputs)
  const edges = workflow.edges ?? [];
  const nodes = workflow.nodes;

  // If there are no edges in the workflow at all, return all outputs
  // This handles legacy workflows where edges might not have been stored
  if (edges.length === 0) {
    return outputs.map((output) => ({
      identifier: output.identifier,
      type: output.type,
    }));
  }

  return outputs
    .filter((output) =>
      isOutputConnectedToNonEvaluator(output.identifier, edges, nodes),
    )
    .map((output) => ({
      identifier: output.identifier,
      type: output.type,
    }));
}

/**
 * Check if all workflow fields have auto-mappable equivalents in trace data.
 * Standard fields like "input", "output", "contexts" can be auto-mapped.
 *
 * @param fields - Array of workflow field definitions
 * @returns True if all fields can be auto-mapped
 */
export function canAutoMapAllFields(fields: WorkflowField[]): boolean {
  const autoMappableFields = new Set(["input", "output", "contexts"]);

  return fields.every((field) => autoMappableFields.has(field.identifier));
}

/**
 * Extract end node inputs from a workflow DSL.
 * These represent the outputs that the workflow produces when used as an evaluator.
 * The End node's inputs are what becomes the evaluator's outputs.
 *
 * @param workflow - The workflow DSL object
 * @returns Array of field definitions from the end node inputs
 */
export function getWorkflowEndInputs(
  workflow: Workflow | null | undefined,
): WorkflowField[] {
  if (!workflow?.nodes) {
    return [];
  }

  // Find the end node
  const endNode = workflow.nodes.find((node) => node.type === "end");

  if (!endNode) {
    return [];
  }

  // Extract inputs from the end node data (these are the workflow's outputs)
  const endData = endNode.data;
  const inputs = endData?.inputs;

  if (!inputs || !Array.isArray(inputs)) {
    return [];
  }

  return inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));
}
