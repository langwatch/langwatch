import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { ATTR_KEYS } from "../canonicalisation/extractors/_constants";
import { SpanNormalizationPipelineService } from "../span-normalization.service";

const service = SpanNormalizationPipelineService.create();

function makeOtlpSpanWithEvaluation(
  evalPayload: Record<string, unknown>,
): OtlpSpan {
  return {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "main",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [],
    events: [
      {
        timeUnixNano: "1700000000500000000",
        name: "langwatch.evaluation.custom",
        attributes: [
          {
            key: "json_encoded_event",
            value: { stringValue: JSON.stringify(evalPayload) },
          },
        ],
      },
    ],
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

describe("SpanNormalizationPipelineService — SDK evaluation events", () => {
  describe("when OTLP span has langwatch.evaluation.custom event", () => {
    it("maps GenAI semconv evaluation attributes", () => {
      const otlpSpan = makeOtlpSpanWithEvaluation({
        name: "toxicity",
        score: 0.95,
        label: "safe",
      });

      const normalized = service.normalizeSpanReceived(
        "tenant-1",
        otlpSpan,
        null,
        null,
      );

      expect(
        normalized.spanAttributes[ATTR_KEYS.GEN_AI_EVALUATION_NAME],
      ).toBe("toxicity");
      expect(
        normalized.spanAttributes[ATTR_KEYS.GEN_AI_EVALUATION_SCORE_VALUE],
      ).toBe(0.95);
    });

    it("does not set langwatch.reserved.evaluations (no metadata leakage)", () => {
      const otlpSpan = makeOtlpSpanWithEvaluation({
        name: "test",
        score: 1,
      });

      const normalized = service.normalizeSpanReceived(
        "tenant-1",
        otlpSpan,
        null,
        null,
      );

      expect(
        normalized.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS],
      ).toBeUndefined();
    });

    it("preserves the original event on the normalized span", () => {
      const otlpSpan = makeOtlpSpanWithEvaluation({
        name: "test",
        score: 1,
      });

      const normalized = service.normalizeSpanReceived(
        "tenant-1",
        otlpSpan,
        null,
        null,
      );

      const evalEvents = normalized.events.filter(
        (e) => e.name === "langwatch.evaluation.custom",
      );
      expect(evalEvents).toHaveLength(1);
    });
  });
});
