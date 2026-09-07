/**
 * @see specs/analytics/filter-value-validation.feature
 *
 * The whole-set walk, which is what the analytics service calls before it
 * decides which table serves a request. Each table has its own filter
 * translator, so a check inside any one of them would leave the others free
 * to keep dropping values.
 */

import { describe, expect, it } from "vitest";
import { assertFiltersAreSupported } from "../supported-values";

describe("assertFiltersAreSupported", () => {
  describe("when a filter set carries only values the fields accept", () => {
    it("passes a flat, a keyed and a key-and-subkey filter together", () => {
      expect(() =>
        assertFiltersAreSupported({
          "traces.error": ["true"],
          "metadata.value": { env: ["prod"] },
          "events.metrics.value": { thumbs_up: { vote: ["0", "1"] } },
        }),
      ).not.toThrow();
    });

    it("passes an empty set and an empty value list", () => {
      expect(() => assertFiltersAreSupported({})).not.toThrow();
      expect(() => assertFiltersAreSupported(undefined)).not.toThrow();
      expect(() =>
        assertFiltersAreSupported({ "traces.error": [] }),
      ).not.toThrow();
    });
  });

  describe("when a filter set carries a value the field cannot apply", () => {
    it("refuses it at the top level", () => {
      expect(() =>
        assertFiltersAreSupported({
          "metadata.user_id": ["someone"],
          "traces.error": ["Traces with error"],
        }),
      ).toThrow(expect.objectContaining({ code: "validation_error" }) as Error);
    });

    it("refuses a keyed filter missing its key", () => {
      expect(() =>
        assertFiltersAreSupported({ "metadata.value": ["prod"] }),
      ).toThrow(expect.objectContaining({ code: "validation_error" }) as Error);
    });

    it("refuses a key-and-subkey filter given only a key", () => {
      expect(() =>
        assertFiltersAreSupported({
          "events.metrics.value": { thumbs_up: ["0", "1"] },
        }),
      ).toThrow(expect.objectContaining({ code: "validation_error" }) as Error);
    });
  });
});
