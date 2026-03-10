import { describe, expect, it } from "vitest";
import type { NormalizedEvent, NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "../extractors/_constants";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";

const service = new CanonicalizeSpanAttributesService();

const stubSpan: Pick<
  NormalizedSpan,
  | "name"
  | "kind"
  | "instrumentationScope"
  | "statusMessage"
  | "statusCode"
  | "parentSpanId"
> = {
  name: "main",
  kind: 1,
  instrumentationScope: { name: "langwatch", version: "1.0" },
  statusMessage: null,
  statusCode: null,
  parentSpanId: null,
} as any;

describe("CanonicalizeSpanAttributesService — evaluation events", () => {
  describe("when span has langwatch.evaluation.custom events", () => {
    it("maps GenAI semconv attributes from first evaluation", () => {
      const events: NormalizedEvent[] = [
        {
          name: "langwatch.evaluation.custom",
          timeUnixMs: Date.now(),
          attributes: {
            json_encoded_event: JSON.stringify({
              name: "relevance",
              score: 0.85,
              label: "relevant",
            }),
          },
        },
      ];

      const result = service.canonicalize({}, events, stubSpan as any);

      expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_NAME]).toBe(
        "relevance",
      );
      expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_SCORE_VALUE]).toBe(
        0.85,
      );
      expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_SCORE_LABEL]).toBe(
        "relevant",
      );
    });

    it("does not set langwatch.reserved.evaluations (no metadata leakage)", () => {
      const events: NormalizedEvent[] = [
        {
          name: "langwatch.evaluation.custom",
          timeUnixMs: Date.now(),
          attributes: {
            json_encoded_event: JSON.stringify({
              name: "test-eval",
              score: 1,
            }),
          },
        },
      ];

      const result = service.canonicalize({}, events, stubSpan as any);

      expect(
        result.attributes[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS],
      ).toBeUndefined();
    });

    it("records the langwatch:evaluation.custom rule", () => {
      const events: NormalizedEvent[] = [
        {
          name: "langwatch.evaluation.custom",
          timeUnixMs: Date.now(),
          attributes: {
            json_encoded_event: JSON.stringify({ name: "test-eval", score: 1 }),
          },
        },
      ];

      const result = service.canonicalize({}, events, stubSpan as any);

      expect(result.appliedRules).toContain("langwatch:evaluation.custom");
    });
  });

  describe("when span has no evaluation events", () => {
    it("does not set GenAI evaluation attributes", () => {
      const result = service.canonicalize({}, [], stubSpan as any);

      expect(
        result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_NAME],
      ).toBeUndefined();
    });
  });
});
