import {
  AGENT_TEST_SET_SUFFIX,
  isInternalSetId,
  VOICE_CALL_SCENARIO_SET_ID,
} from "@langwatch/scenario-contract";

/**
 * Whether a set counts as a simulation against the plan's cap. Platform-owned
 * sets (internal suite and on-platform runs, agent tests, voice calls) are
 * left out, matching what the distinct-set count leaves out.
 */
export function isCountedScenarioSet(scenarioSetId: string): boolean {
  return (
    !isInternalSetId(scenarioSetId) &&
    !scenarioSetId.endsWith(AGENT_TEST_SET_SUFFIX) &&
    scenarioSetId !== VOICE_CALL_SCENARIO_SET_ID
  );
}
