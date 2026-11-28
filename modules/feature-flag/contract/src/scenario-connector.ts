/**
 * The release flag for Scenario Connector steps (ADR-194). Client-bundled code reads this, so
 * keep runtime imports out.
 */
export const SCENARIO_CONNECTOR_FLAG_KEY = "release_scenario_connector_steps" as const;
