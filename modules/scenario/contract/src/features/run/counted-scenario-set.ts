import { AGENT_TEST_SET_SUFFIX } from "../../agent-test-scenario.ts";
import { isInternalSetId, VOICE_CALL_SCENARIO_SET_ID } from "./scenario-set-id.ts";

/**
 * Whether a set's runs count against a plan's scenario caps. Platform-owned sets
 * (internal suite and on-platform runs, agent tests, voice calls) are left out,
 * both where a run is refused and where the month's runs are counted.
 */
export function isCountedScenarioSet(scenarioSetId: string): boolean {
  return (
    !isInternalSetId(scenarioSetId) &&
    !scenarioSetId.endsWith(AGENT_TEST_SET_SUFFIX) &&
    scenarioSetId !== VOICE_CALL_SCENARIO_SET_ID
  );
}
