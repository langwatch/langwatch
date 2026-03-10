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
    it("sets langwatch.reserved.evaluations from event payload", () => {
      const evalPayload = {
        evaluation_id: "eval_abc123",
        name: "toxicity",
        score: 0.95,
        passed: true,
        label: "safe",
      };
      const events: NormalizedEvent[] = [
        {
          name: "langwatch.evaluation.custom",
          timeUnixMs: Date.now(),
          attributes: {
            json_encoded_event: JSON.stringify(evalPayload),
          },
        },
      ];

      const result = service.canonicalize({}, events, stubSpan as any);

      expect(
        result.attributes[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS],
      ).toBeDefined();
      const evaluations = JSON.parse(
        result.attributes[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS] as string,
      );
      expect(evaluations).toHaveLength(1);
      expect(evaluations[0]).toMatchObject({
        evaluation_id: "eval_abc123",
        name: "toxicity",
        score: 0.95,
        passed: true,
        label: "safe",
      });
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

    it("sets GenAI semconv evaluation attributes from first evaluation", () => {
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
  });

  describe("when span has no evaluation events", () => {
    it("does not set langwatch.reserved.evaluations", () => {
      const result = service.canonicalize({}, [], stubSpan as any);

      expect(
        result.attributes[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS],
      ).toBeUndefined();
    });
  });

  describe("when span has evaluation events mixed with other events", () => {
    it("extracts only evaluation events", () => {
      const events: NormalizedEvent[] = [
        {
          name: "some.other.event",
          timeUnixMs: Date.now(),
          attributes: { foo: "bar" },
        },
        {
          name: "langwatch.evaluation.custom",
          timeUnixMs: Date.now(),
          attributes: {
            json_encoded_event: JSON.stringify({ name: "accuracy", score: 0.9 }),
          },
        },
      ];

      const result = service.canonicalize({}, events, stubSpan as any);

      const evaluations = JSON.parse(
        result.attributes[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS] as string,
      );
      expect(evaluations).toHaveLength(1);
      expect(evaluations[0].name).toBe("accuracy");
    });
  });
});
