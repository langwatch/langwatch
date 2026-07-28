import { describe, expect, it } from "vitest";
import { evaluationRunDataSchema } from "~/server/app-layer/evaluations/types";
import {
  findNonCanonicalStateValues,
  type StateFinding,
} from "~/server/filters/evaluationStateFindings";

/**
 * The canonical execution-state domain, derived from the schema so this
 * suite cannot go stale relative to it.
 */
const CANONICAL_STATUS_VALUES = evaluationRunDataSchema.shape.status.options;

describe("findNonCanonicalStateValues", () => {
  describe("given an evaluations.state filter for a single evaluator", () => {
    describe("when the value is a non-canonical phantom", () => {
      it("reports exactly one finding for the offending value", () => {
        const findings = findNonCanonicalStateValues({
          "evaluations.state": { e1: ["Error_Message"] },
        });

        const expected: StateFinding[] = [
          {
            evaluatorKey: "e1",
            offendingValue: "Error_Message",
            action: "reported_unmappable",
          },
        ];
        expect(findings).toEqual(expected);
      });
    });

    describe("when the value is one of the canonical execution states", () => {
      for (const status of CANONICAL_STATUS_VALUES) {
        it(`reports no finding for "${status}"`, () => {
          const findings = findNonCanonicalStateValues({
            "evaluations.state": { e1: [status] },
          });

          expect(findings).toEqual([]);
        });
      }
    });

    describe("when the array mixes a phantom with a canonical value", () => {
      it("reports only the offending element", () => {
        const findings = findNonCanonicalStateValues({
          "evaluations.state": { e1: ["Error_Message", "processed"] },
        });

        const expected: StateFinding[] = [
          {
            evaluatorKey: "e1",
            offendingValue: "Error_Message",
            action: "reported_unmappable",
          },
        ];
        expect(findings).toEqual(expected);
      });
    });

    describe("when the value is a legacy pass/fail label", () => {
      it('reports "succeeded" as a finding, not a canonical value', () => {
        const findings = findNonCanonicalStateValues({
          "evaluations.state": { e1: ["succeeded"] },
        });

        const expected: StateFinding[] = [
          {
            evaluatorKey: "e1",
            offendingValue: "succeeded",
            action: "reported_unmappable",
          },
        ];
        expect(findings).toEqual(expected);
      });

      it('reports "failed" as a finding, not a canonical value', () => {
        const findings = findNonCanonicalStateValues({
          "evaluations.state": { e1: ["failed"] },
        });

        const expected: StateFinding[] = [
          {
            evaluatorKey: "e1",
            offendingValue: "failed",
            action: "reported_unmappable",
          },
        ];
        expect(findings).toEqual(expected);
      });
    });
  });

  describe("given phantom values across multiple evaluators", () => {
    describe("when two different evaluator keys each hold a phantom", () => {
      it("reports one finding per evaluator key", () => {
        const findings = findNonCanonicalStateValues({
          "evaluations.state": {
            e1: ["Weird_Legacy"],
            e2: ["Error_Message"],
          },
        });

        expect(findings).toHaveLength(2);
        expect(findings).toEqual(
          expect.arrayContaining([
            {
              evaluatorKey: "e1",
              offendingValue: "Weird_Legacy",
              action: "reported_unmappable",
            },
            {
              evaluatorKey: "e2",
              offendingValue: "Error_Message",
              action: "reported_unmappable",
            },
          ]),
        );
      });
    });
  });

  describe("given a filters object with no evaluations.state key", () => {
    describe("when the phantom-shaped value sits under metadata.value", () => {
      it("reports nothing", () => {
        const findings = findNonCanonicalStateValues({
          "metadata.value": { reason: ["Error_Message"] },
        });

        expect(findings).toEqual([]);
      });
    });

    describe("when the phantom-shaped value sits under the evaluations.label sibling field", () => {
      it("reports nothing", () => {
        // The naive implementation this guards against is a prefix match on
        // "evaluations." — evaluations.label is not evaluations.state.
        const findings = findNonCanonicalStateValues({
          "evaluations.label": { e1: ["Error_Message"] },
        });

        expect(findings).toEqual([]);
      });
    });

    describe("when the filters object only has spans.model", () => {
      it("reports nothing", () => {
        const findings = findNonCanonicalStateValues({
          "spans.model": ["gpt-5-mini"],
        });

        expect(findings).toEqual([]);
      });
    });
  });

  describe("given a malformed filters argument", () => {
    describe("when the input is not a usable object", () => {
      it("returns no findings and does not throw for a number", () => {
        expect(() => findNonCanonicalStateValues(42)).not.toThrow();
        expect(findNonCanonicalStateValues(42)).toEqual([]);
      });

      it("returns no findings and does not throw for null", () => {
        expect(() => findNonCanonicalStateValues(null)).not.toThrow();
        expect(findNonCanonicalStateValues(null)).toEqual([]);
      });

      it("returns no findings and does not throw for a string", () => {
        expect(() =>
          findNonCanonicalStateValues("not-an-object"),
        ).not.toThrow();
        expect(findNonCanonicalStateValues("not-an-object")).toEqual([]);
      });

      it("returns no findings and does not throw for an array", () => {
        expect(() =>
          findNonCanonicalStateValues(["evaluations.state"]),
        ).not.toThrow();
        expect(findNonCanonicalStateValues(["evaluations.state"])).toEqual(
          [],
        );
      });
    });
  });
});
