import { describe, expect, it } from "vitest";
import type { CanonicalEvent } from "@langwatch/trace-contract";
import { canonicalisation, makeStubSpan } from "./test-helpers";
import { ATTR_KEYS } from "@langwatch/trace-contract";

const stubSpan = makeStubSpan({
  name: "main",
  kind: 1,
  instrumentationScope: { name: "langwatch", version: "1.0" },
});

describe("TraceCanonicalisationService — evaluation events", () => {
  describe("when span has langwatch.evaluation.custom events", () => {
    it("maps GenAI semconv attributes from first evaluation", () => {
      const events: CanonicalEvent[] = [
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

      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {},
        events: events,
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_NAME]).toBe("relevance");
      expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_SCORE_VALUE]).toBe(0.85);
      expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_SCORE_LABEL]).toBe("relevant");
    });

    it("does not set langwatch.reserved.evaluations (no metadata leakage)", () => {
      const events: CanonicalEvent[] = [
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

      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {},
        events: events,
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS]).toBeUndefined();
    });

    describe("when json_encoded_event is already a parsed object", () => {
      it("maps GenAI semconv attributes from pre-parsed payload", () => {
        const events: CanonicalEvent[] = [
          {
            name: "langwatch.evaluation.custom",
            timeUnixMs: Date.now(),
            attributes: {
              json_encoded_event: {
                name: "toxicity",
                score: 0.95,
                label: "safe",
              },
            },
          },
        ];

        const result = canonicalisation.canonicalizeSpanAttributes({
          spanAttributes: {},
          events: events,
          span: stubSpan,
        });

        expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_NAME]).toBe("toxicity");
        expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_SCORE_VALUE]).toBe(0.95);
        expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_SCORE_LABEL]).toBe("safe");
        expect(result.appliedRules).toContain("langwatch:evaluation.custom");
      });
    });

    it("records the langwatch:evaluation.custom rule", () => {
      const events: CanonicalEvent[] = [
        {
          name: "langwatch.evaluation.custom",
          timeUnixMs: Date.now(),
          attributes: {
            json_encoded_event: JSON.stringify({ name: "test-eval", score: 1 }),
          },
        },
      ];

      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {},
        events: events,
        span: stubSpan,
      });

      expect(result.appliedRules).toContain("langwatch:evaluation.custom");
    });
  });

  describe("when span has no evaluation events", () => {
    it("does not set GenAI evaluation attributes", () => {
      const result = canonicalisation.canonicalizeSpanAttributes({
        spanAttributes: {},
        events: [],
        span: stubSpan,
      });

      expect(result.attributes[ATTR_KEYS.GEN_AI_EVALUATION_NAME]).toBeUndefined();
    });
  });
});
