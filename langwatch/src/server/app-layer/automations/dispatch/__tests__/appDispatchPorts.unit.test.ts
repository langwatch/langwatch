import { describe, expect, it } from "vitest";
import { triggerReadsEvaluations } from "../appDispatchPorts";

describe("triggerReadsEvaluations", () => {
  describe("when the trigger uses a filterQuery (ADR-043)", () => {
    it("is true when the query references an evaluator field", () => {
      expect(
        triggerReadsEvaluations({
          filters: {},
          filterQuery: "evaluatorVerdict:pass",
        }),
      ).toBe(true);
    });

    it("is false when the query is trace-only", () => {
      expect(
        triggerReadsEvaluations({ filters: {}, filterQuery: "status:error" }),
      ).toBe(false);
    });

    it("ignores the legacy filters when a filterQuery is present", () => {
      // Even though the structured filters carry an evaluation predicate, a
      // trace-only filterQuery supersedes them — the query is the source of
      // truth for a filterQuery trigger.
      expect(
        triggerReadsEvaluations({
          filters: { "evaluations.evaluator_id": ["ev-1"] },
          filterQuery: "status:error",
        }),
      ).toBe(false);
    });
  });

  describe("when the trigger uses legacy structured filters", () => {
    it("is true when the filters carry an evaluation predicate", () => {
      expect(
        triggerReadsEvaluations({
          filters: { "evaluations.evaluator_id": ["ev-1"] },
          filterQuery: null,
        }),
      ).toBe(true);
    });

    it("is false for trace-only filters", () => {
      expect(
        triggerReadsEvaluations({
          filters: { "traces.origin": ["application"] },
          filterQuery: null,
        }),
      ).toBe(false);
    });
  });
});

