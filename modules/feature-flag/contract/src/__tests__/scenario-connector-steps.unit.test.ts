/**
 * @vitest-environment node
 * The Scenario Connector release gate (ADR-194) stays off by default on every deployment until the
 * owner decides its defaults.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { describe, expect, it } from "vitest";

import { pickFlagDefinition } from "../feature-flag.ts";
import { SCENARIO_CONNECTOR_STEPS_FLAG_KEY } from "../scenario-connector-steps.ts";

describe("the release_scenario_connector_steps flag", () => {
  /** @scenario "The connector release flag is off by default on every deployment" */
  it("is a registered product flag whose default is off", () => {
    expect(pickFlagDefinition(SCENARIO_CONNECTOR_STEPS_FLAG_KEY)).toMatchObject({
      key: "release_scenario_connector_steps",
      scope: "PRODUCT",
      defaultValue: false,
    });
  });
});
