import { testAgent as apiTestAgent } from "../langwatch-api-agents.js";

/**
 * Handles the platform_test_agent MCP tool invocation.
 *
 * @see specs/agents/agent-test-run.feature
 */
export async function handleTestAgent(params: { id: string }): Promise<string> {
  const run = await apiTestAgent(params.id);
  return [
    'Test run scheduled. The user sends "ping"; the run succeeds when the agent answers.',
    "",
    `**Scenario run ID:** ${run.scenarioRunId}`,
    `**Batch run ID:** ${run.batchRunId}`,
    "",
    `Follow it with platform_get_simulation_run using scenarioRunId "${run.scenarioRunId}".`,
  ].join("\n");
}
