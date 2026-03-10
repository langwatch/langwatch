import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { ATTR_KEYS } from "../canonicalisation/extractors/_constants";
import { SpanNormalizationPipelineService } from "../span-normalization.service";

const service = SpanNormalizationPipelineService.create();

/**
 * Minimal valid OTLP span with a langwatch.evaluation.custom event.
 * Mimics what the Python SDK sends when add_evaluation() is called.
 */
function makeOtlpSpanWithEvaluation(evalPayload: Record<string, unknown>): OtlpSpan {
  return {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "main",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [
      {
        key: "langwatch.span.type",
        value: { stringValue: "llm" },
      },
    ],
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
    it("produces langwatch.reserved.evaluations in normalized span attributes", () => {
      const evalPayload = {
        evaluation_id: "eval_abc123",
        name: "toxicity",
        score: 0.95,
        passed: true,
      };
      const otlpSpan = makeOtlpSpanWithEvaluation(evalPayload);

      const normalized = service.normalizeSpanReceived(
        "tenant-1",
        otlpSpan,
        null,
        null,
      );

      const raw = normalized.spanAttributes[
        ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS
      ] as string;
      expect(raw).toBeDefined();
      const evaluations = JSON.parse(raw);
      expect(evaluations).toHaveLength(1);
      expect(evaluations[0]).toMatchObject({
        evaluation_id: "eval_abc123",
        name: "toxicity",
        score: 0.95,
        passed: true,
      });
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

      // Events remain after canonicalization (read without consuming)
      const evalEvents = normalized.events.filter(
        (e) => e.name === "langwatch.evaluation.custom",
      );
      expect(evalEvents).toHaveLength(1);
    });
  });
});
