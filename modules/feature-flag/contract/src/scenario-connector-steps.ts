/** The release gate for Scenario Connector blocks (ADR-194), off by default everywhere. */
export const SCENARIO_CONNECTOR_STEPS_FLAG_KEY = "release_scenario_connector_steps" as const;

/** What every block of a connector agent records while the release is off for its project. */
export const SCENARIO_CONNECTOR_NOT_RELEASED_MESSAGE =
  "Connector steps are not released for this project yet.";
