import type { Workflow, Entry } from "../types/dsl";

/**
 * Field definition extracted from a workflow entry node
 */
export interface WorkflowField {
  identifier: string;
  type: string;
}

/**
 * Extract entry node outputs from a workflow DSL.
 * These represent the fields that can be mapped to trace data when
 * using the workflow as an evaluator.
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

  // Return the outputs as WorkflowField objects
  return outputs.map((output) => ({
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
