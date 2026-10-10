import { scenarioClient, type ScenarioInputs } from "@langwatch/scenario-client";

/**
 * The runs of one suite or external set. It has no timer: run events and the freshness probe
 * drive its refetches, so a quiet set never re-downloads its runs.
 */
export function useSuiteRunData({
  input,
  enabled,
}: {
  input: ScenarioInputs["scenarios"]["getSuiteRunData"];
  enabled: boolean;
}) {
  return scenarioClient.scenarios.getSuiteRunData.useQuery(input, { enabled });
}
