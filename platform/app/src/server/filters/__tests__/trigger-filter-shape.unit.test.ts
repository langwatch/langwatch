import { describe, expect, it } from "vitest";
import {
  findEvaluationFilterReferences,
  findUnkeyedFilterFields,
} from "../trigger-filter-shape";

describe("findUnkeyedFilterFields()", () => {
  describe("when a keyed field is written as a bare list", () => {
    /** @scenario "A keyed condition written without its key is refused" */
    it("names evaluations.passed and shows it keyed by a monitor", () => {
      expect(
        findUnkeyedFilterFields({ "evaluations.passed": ["false"] }),
      ).toEqual([
        {
          field: "evaluations.passed",
          example: '{"evaluations.passed":{"<monitorId>":["false"]}}',
        },
      ]);
    });

    it("names metadata.value and shows it keyed by a metadata key", () => {
      expect(findUnkeyedFilterFields({ "metadata.value": ["true"] })).toEqual([
        {
          field: "metadata.value",
          example: '{"metadata.value":{"<metadataKey>":["true"]}}',
        },
      ]);
    });

    it("shows both levels for a field that needs a key and a subkey", () => {
      expect(
        findUnkeyedFilterFields({ "events.metrics.value": { thumbs: ["1"] } }),
      ).toEqual([
        {
          field: "events.metrics.value",
          example:
            '{"events.metrics.value":{"<eventType>":{"<metricKey>":["1"]}}}',
        },
      ]);
    });
  });

  describe("when keyed fields carry their key", () => {
    it("finds nothing", () => {
      expect(
        findUnkeyedFilterFields({
          "evaluations.passed": { monitor_1: ["false"] },
          "metadata.value": { plan: ["pro"] },
          "events.metrics.value": { thumbs: { vote: ["1"] } },
        }),
      ).toEqual([]);
    });
  });

  describe("when a field needs no key or a bare list is empty", () => {
    it("finds nothing", () => {
      expect(
        findUnkeyedFilterFields({
          "spans.model": ["gpt-5-mini"],
          "evaluations.passed": [],
          "unknown.field": ["x"],
        }),
      ).toEqual([]);
    });
  });
});

describe("findEvaluationFilterReferences()", () => {
  it("reads keyed evaluation fields by key and id lists by value", () => {
    expect(
      findEvaluationFilterReferences({
        "evaluations.passed": { monitor_1: ["false"] },
        "evaluations.score": { monitor_2: { score: ["0.5"] } },
        "evaluations.evaluator_id": ["monitor_3"],
        "metadata.value": { plan: ["pro"] },
      }),
    ).toEqual([
      { field: "evaluations.passed", id: "monitor_1" },
      { field: "evaluations.score", id: "monitor_2" },
      { field: "evaluations.evaluator_id", id: "monitor_3" },
    ]);
  });
});
