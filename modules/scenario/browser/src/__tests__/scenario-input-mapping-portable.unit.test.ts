import * as contract from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import * as authoring from "../ui/sections/suites/scenario-input-mapping-section.tsx";

describe("the scenario authoring surface's input mapping", () => {
  describe("when it asks whether a mapping is usable", () => {
    /** @scenario "Scenario input mapping is portable" */
    it("answers with the scenario contract's own rules, not a copy", () => {
      expect(authoring.isScenarioMappingValid).toBe(contract.isScenarioMappingValid);
      expect(authoring.hasScenarioInputMapping).toBe(contract.hasScenarioInputMapping);
    });
  });
});
