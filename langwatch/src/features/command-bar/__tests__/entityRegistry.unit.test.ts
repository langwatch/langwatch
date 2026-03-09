/**
 * @vitest-environment node
 *
 * Unit tests for entity registry scenario prefix support.
 * @see specs/features/scenarios/scenario-id-format.feature
 * Scenario: Command bar entity registry recognizes both prefixes
 */

import { describe, expect, it } from "vitest";
import {
  entityRegistry,
  findEntityByPrefix,
} from "../entityRegistry";

describe("entityRegistry", () => {
  describe("when looking up scenario prefixes", () => {
    it("has an entry for the 'scenario_' prefix", () => {
      const entry = entityRegistry.find((e) => e.prefix === "scenario_");
      expect(entry).toBeDefined();
      expect(entry?.label).toBe("Scenario");
    });

    it("has an entry for the legacy 'scen_' prefix", () => {
      const entry = entityRegistry.find((e) => e.prefix === "scen_");
      expect(entry).toBeDefined();
      expect(entry?.label).toBe("Scenario");
    });

    it("recognizes a scenario_ ID via findEntityByPrefix()", () => {
      const result = findEntityByPrefix("scenario_abc123");
      expect(result).toBeDefined();
      expect(result?.prefix).toBe("scenario_");
    });

    it("recognizes a legacy scen_ ID via findEntityByPrefix()", () => {
      const result = findEntityByPrefix("scen_abc123");
      expect(result).toBeDefined();
      expect(result?.prefix).toBe("scen_");
    });
  });
});
