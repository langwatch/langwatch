/**
 * Pre-run validation for workflow agent scenario mappings.
 *
 * Validates that a workflow agent has the necessary scenario mappings
 * configured before execution begins. This prevents confusing runtime
 * failures when a multi-input workflow receives empty strings for all
 * but its first input.
 */

import { TRPCError } from "@trpc/server";
import type { WorkflowAgentData } from "./types";

/**
 * Validates that a workflow agent's scenario mappings are sufficient to
 * execute the workflow.
 *
 * Throws a structured BAD_REQUEST error when the workflow has more than one
 * declared input and no scenario mappings are configured. The single-input
 * case is allowed through because the legacy fallback (first input ← last
 * user message) handles it correctly.
 */
export function validateWorkflowAgentMappings({
  agentId,
  inputs,
  scenarioMappings,
}: Pick<
  WorkflowAgentData,
  "agentId" | "inputs" | "scenarioMappings"
>): void {
  const hasMappings =
    scenarioMappings !== undefined &&
    Object.keys(scenarioMappings).length > 0;

  if (hasMappings) return;

  if (inputs.length <= 1) return;

  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `Workflow agent '${agentId}' has ${inputs.length} inputs but no scenario mappings configured. ` +
      `Open the agent editor to configure how scenario data maps to the workflow's inputs.`,
  });
}
