/**
 * @vitest-environment node
 * The Scenario Connector release gate (ADR-194) is off by default on cloud and self-hosted, and is
 * turned on per project.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { describe, expect, it } from "vitest";

import { pickFlagDefinition } from "../feature-flag.ts";

describe("the release_scenario_connector_steps flag", () => {
  /** @scenario "The connector release flag is off by default on every deployment" */
  it("is a registered product flag whose default is off", () => {
    expect(pickFlagDefinition("release_scenario_connector_steps")).toMatchObject({
      key: "release_scenario_connector_steps",
      scope: "PRODUCT",
      defaultValue: false,
    });
  });

  /** @scenario "The connector release flag is off by default on every deployment" */
  it("is off by default on a self-hosted install", () => {
    const flag = pickFlagDefinition("release_scenario_connector_steps");

    // A self-hosted install falls back to defaultValue when no self-hosted default is declared.
    expect(flag?.selfHostedDefaultValue ?? flag?.defaultValue).toBe(false);
  });
});
