import { describe, expect, it } from "vitest";
import {
  RequestValidationError,
  type SchemaFailure,
} from "~/server/api/validation";
import {
  assertLegacyFiltersKeyed,
  legacyFiltersKeyedRefusal,
} from "../assertLegacyFiltersKeyed";

describe("assertLegacyFiltersKeyed()", () => {
  describe("when a keyed filter carries its key", () => {
    it("accepts it", () => {
      expect(() =>
        assertLegacyFiltersKeyed({
          filters: { "evaluations.passed": { "evaluator-1": ["false"] } },
          offersFilterString: true,
        }),
      ).not.toThrow();
    });
  });

  describe("when a keyed filter is empty", () => {
    it("accepts it, since an empty filter applies no condition", () => {
      expect(() =>
        assertLegacyFiltersKeyed({
          filters: { "evaluations.passed": [], "metadata.value": {} },
          offersFilterString: true,
        }),
      ).not.toThrow();
    });
  });

  describe("when a keyed filter is a flat list", () => {
    it("refuses it with 422, naming the field and the filter-string form", () => {
      let thrown: unknown;
      try {
        assertLegacyFiltersKeyed({
          filters: { "evaluations.passed": ["false"] },
          offersFilterString: true,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RequestValidationError);
      const error = thrown as RequestValidationError;
      expect(error.httpStatus).toBe(422);
      expect(error.meta?.fields).toEqual(["filters.evaluations.passed"]);
      const reason = error.reasons[0] as SchemaFailure | undefined;
      expect(String(reason?.meta?.message)).toContain("evaluatorVerdict:fail");
    });
  });

  describe("when a filter needing a key and a subkey has only the key", () => {
    it("refuses it", () => {
      expect(() =>
        assertLegacyFiltersKeyed({
          filters: { "events.metrics.value": { thumbs_up_down: ["1", "1"] } },
          offersFilterString: false,
        }),
      ).toThrow(RequestValidationError);
    });
  });

  describe("when a filter needing a key and a subkey has both", () => {
    it("accepts it", () => {
      expect(() =>
        assertLegacyFiltersKeyed({
          filters: {
            "events.metrics.value": { thumbs_up_down: { vote: ["1", "1"] } },
          },
          offersFilterString: false,
        }),
      ).not.toThrow();
    });
  });

  describe("when a filter needs no key", () => {
    it("accepts a flat list", () => {
      expect(() =>
        assertLegacyFiltersKeyed({
          filters: { "traces.error": ["true"] },
          offersFilterString: true,
        }),
      ).not.toThrow();
    });
  });
});

describe("legacyFiltersKeyedRefusal()", () => {
  describe("when the route has no filter string", () => {
    it("explains the keyed shape without pointing at a filter string", () => {
      const refusal = legacyFiltersKeyedRefusal({
        "evaluations.passed": ["false"],
      });
      expect(refusal).toContain('{"evaluations.passed": {"<');
      expect(refusal).not.toContain("evaluatorVerdict");
    });
  });

  describe("when every filter is well formed", () => {
    it("returns nothing", () => {
      expect(
        legacyFiltersKeyedRefusal({ "traces.error": ["true"] }),
      ).toBeUndefined();
    });
  });
});
