/**
 * The one-off scenario that "Test agent" runs against an agent.
 *
 * No scenario row exists for it. The run carries a fixed scenario id, a fixed
 * conversation and its own internal set, so the execution path treats it
 * like any other run while nothing is saved and the results lists leave it
 * out.
 *
 * Pattern of the set id: __internal__${projectId}__agent-test
 *
 * @see specs/agents/agent-test-run.feature
 */

import { INTERNAL_SET_PREFIX } from "./internal-set-id";

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
  return (
    setId.startsWith(INTERNAL_SET_PREFIX) &&
    setId.endsWith(AGENT_TEST_SET_SUFFIX)
  );
}

/** Whether a scenario id names the agent test scenario. */
export function isAgentTestScenarioId(scenarioId: string): boolean {
  return scenarioId === AGENT_TEST_SCENARIO_ID;
}

/**
 * The scenario definition of an agent test run, as the child receives it.
 * The situation is what the run drawer shows as the description.
 */
export function agentTestScenarioConfig({ agentName }: { agentName: string }) {
  return {
    id: AGENT_TEST_SCENARIO_ID,
    name: `Test ${agentName}`,
    situation: `The user sends "${AGENT_TEST_USER_MESSAGE}" and the agent answers. The run succeeds when the answer arrives.`,
    criteria: [] as string[],
    labels: [] as string[],
  };
}
