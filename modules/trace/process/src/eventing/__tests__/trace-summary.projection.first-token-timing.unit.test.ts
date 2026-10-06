/**
 * @vitest-environment node
 * Spec: modules/trace/specs/sdk-timing-and-metrics-canonicalisation.feature
 */
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import {
  createSpanReceivedEvent,
  createTestRuntime,
  msToUnixNano,
} from "./trace-summary-test.fixtures.ts";

const fold = TraceSummaryFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

/** The fixture span starts at 1_700_000_000_500 ms. */
const SPAN_START_MS = 1_700_000_000_500;

function llmSpan({
  timestamps,
  streamEventAtMs,
}: {
  timestamps?: Record<string, number>;
  streamEventAtMs?: number;
}): SpanReceivedEvent {
  const event = createSpanReceivedEvent({
    attributes: {
      "gen_ai.request.model": "gpt-5-mini",
      "langwatch.output": "an answer",
      ...(timestamps ? { "langwatch.timestamps": JSON.stringify(timestamps) } : {}),
    },
  });
  if (streamEventAtMs !== undefined) {
    event.data.span.events = [
      {
        name: "gen_ai.content.chunk",
        timeUnixNano: msToUnixNano(streamEventAtMs),
        attributes: [],
        droppedAttributesCount: 0,
      },
    ];
  }
  return event;
}

function timeToFirstTokenOf(event: SpanReceivedEvent): number | null {
  return fold.handleTraceSpanReceived(event, fold.init()).timeToFirstTokenMs;
}

describe("the trace summary fold's time to first token", () => {
  describe("given an LLM span whose langwatch.timestamps carries first_token_at", () => {
    describe("when the span has no first-token stream event and no time-to-first-token attribute", () => {
      /** @scenario Span with first_token_at populates the trace summary TTFT */
      it("records the offset from the span start", () => {
        const ttft = timeToFirstTokenOf(
          llmSpan({ timestamps: { first_token_at: SPAN_START_MS + 800 } }),
        );

        expect(ttft).toBe(800);
      });
    });

    describe("when a first-token stream event also arrived", () => {
      /** @scenario Stream events win over langwatch.timestamps */
      it("records the stream event's offset, not the timestamps'", () => {
        const ttft = timeToFirstTokenOf(
          llmSpan({
            timestamps: { first_token_at: SPAN_START_MS + 800 },
            streamEventAtMs: SPAN_START_MS + 500,
          }),
        );

        expect(ttft).toBe(500);
      });
    });

    describe("when first_token_at is earlier than the span start", () => {
      /** @scenario first_token_at before the span start is ignored */
      it("records no time to first token", () => {
        const ttft = timeToFirstTokenOf(
          llmSpan({ timestamps: { first_token_at: SPAN_START_MS - 100 } }),
        );

        expect(ttft).toBeNull();
      });
    });
  });
});
