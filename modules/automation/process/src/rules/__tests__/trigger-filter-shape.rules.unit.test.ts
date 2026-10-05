import { describe, expect, it } from "vitest";

import { findEvaluationFilterReferences } from "../trigger-filter-shape.rules.ts";

describe("findEvaluationFilterReferences()", () => {
  it("reads keyed evaluation fields by key and id lists by value", () => {
    expect(
      findEvaluationFilterReferences({
        "evaluations.passed": { monitor_1: ["true"] },
        "evaluations.evaluator_id": ["evaluator_2"],
        "traces.error": ["true"],
      }),
    ).toEqual([
      { field: "evaluations.passed", id: "monitor_1" },
      { field: "evaluations.evaluator_id", id: "evaluator_2" },
    ]);
  });
});
