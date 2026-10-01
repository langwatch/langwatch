/**
 * One-off scenario for agent test runs: internal set, no suite, excluded from results.
 */

import type { TargetConfig } from "./scenario-execution-data.ts";
import { INTERNAL_SET_PREFIX } from "./scenario-set-id.ts";

/** Suffix of the set that holds a project's agent test runs. */
export const AGENT_TEST_SET_SUFFIX = "__agent-test";

/** The scenario id every agent test run carries. There is no row behind it. */
export const AGENT_TEST_SCENARIO_ID = `${INTERNAL_SET_PREFIX}agent-test`;

/** The one message the scripted user sends. */
export const AGENT_TEST_USER_MESSAGE = "ping";

/** The set id of a project's agent test runs. */
export function getAgentTestSetId(projectId: string): string {
  return `${INTERNAL_SET_PREFIX}${projectId}${AGENT_TEST_SET_SUFFIX}`;
}

/** Whether a set id holds agent test runs. */
export function isAgentTestSetId(setId: string): boolean {
  return setId.startsWith(INTERNAL_SET_PREFIX) && setId.endsWith(AGENT_TEST_SET_SUFFIX);
}

/** Whether a scenario id names the agent test scenario. */
export function isAgentTestScenarioId(scenarioId: string): boolean {
  return scenarioId === AGENT_TEST_SCENARIO_ID;
}

/**
 * The scenario definition of an agent test run, as the child receives it.
 * The situation is what the run drawer shows as the description.
 */
export function agentTestScenarioConfig({ agentName }: { agentName: string }): {
  id: string;
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
} {
  return {
    id: AGENT_TEST_SCENARIO_ID,
    name: `Test ${agentName}`,
    situation: `The user sends "${AGENT_TEST_USER_MESSAGE}" and the agent answers. The run succeeds when the answer arrives.`,
    criteria: [] as string[],
    labels: [] as string[],
  };
}

/**
 * The target a test points at, or nothing for a kind no run targets.
 * A prompt or a signature has none, so "Test agent" refuses both.
 */
export function mapAgentTestTarget(agent: { id: string; type: string }): TargetConfig | null {
  switch (agent.type) {
    case "http":
    case "code":
    case "workflow":
    case "connected":
      return { type: agent.type, referenceId: agent.id };
    default:
      return null;
  }
}
