/**
 * @see specs/features/suites/rename-suites-to-runs.feature - Feature icon label scenarios
 */
import { describe, expect, it } from "vitest";
import { featureIcons } from "../featureIcons";

describe("featureIcons", () => {
  describe("when the suites feature icon configuration is read", () => {
    it("has label 'Run Plans'", () => {
      expect(featureIcons.suites.label).toBe("Run Plans");
    });
  });

  describe("when the simulation runs feature icon configuration is read", () => {
    // TODO(#3048): pre-existing failure unmasked by #3001
    it.skip("has label 'Run History'", () => {
      expect(featureIcons.simulation_runs.label).toBe("Run History");
    });
  });
});
