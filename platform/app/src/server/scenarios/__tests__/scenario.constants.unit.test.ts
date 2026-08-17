/**
 * @vitest-environment node
 *
 * Pins DEFAULT_SCENARIO_MAX_TURNS to the scenario SDK's own default. The
 * constant claims to mirror the SDK and the form copy promises "default of
 * 10 turns", so a vendored SDK bump that moves the default fails here
 * instead of silently lying to the user. The SDK import lives only in this
 * test: scenario.constants.ts is shared with the client bundle and must not
 * pull the SDK in.
 *
 * @see specs/scenarios/scenario-max-turns.feature
 */
import { DEFAULT_MAX_TURNS } from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO_MAX_TURNS } from "../scenario.constants";

describe("DEFAULT_SCENARIO_MAX_TURNS", () => {
  describe("given the vendored scenario SDK", () => {
    /** @scenario "A scenario without a turn cap runs with the engine default" */
    it("matches the SDK's own default turn cap", () => {
      expect(DEFAULT_SCENARIO_MAX_TURNS).toBe(DEFAULT_MAX_TURNS);
    });
  });
});
