/**
 * Pre-run validation for workflow agent scenario mappings: prevents runtime failures
 * when multi-input workflow receives empty strings.
 */

import type { WorkflowAgentData } from "@langwatch/scenario-contract";
import { TRPCError } from "@trpc/server";

/**
 * Validates workflow agent's scenario mappings. Throws BAD_REQUEST for multi-input
 * workflows with no mappings; single-input allowed (legacy fallback handles it).
 */
export class ScenarioWorkflowMappingService {
  static create(): ScenarioWorkflowMappingService {
    return new ScenarioWorkflowMappingService();
  }

  private constructor() {}

  validate({
    agentId,
    inputs,
    scenarioMappings,
  }: Pick<WorkflowAgentData, "agentId" | "inputs" | "scenarioMappings">): void {
    const hasMappings = scenarioMappings !== undefined && Object.keys(scenarioMappings).length > 0;

    if (hasMappings) {
      return;
    }

    if (inputs.length <= 1) {
      return;
    }

    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `Workflow agent '${agentId}' has ${inputs.length} inputs but no scenario mappings configured. ` +
        `Open the agent editor to configure how scenario data maps to the workflow's inputs.`,
    });
  }
}
