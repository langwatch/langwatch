import { describe, expect, it } from "vitest";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "@langwatch/trace-contract";
import { TraceCanonicalisationService, TraceIOExtractionService } from "@langwatch/trace-server";
import { TraceReadFullIo } from "../trace-read.composition.ts";

function capturedSpan(spanAttributes: NormalizedSpan["spanAttributes"]): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "project-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "assistant",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes,
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.UNSET,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
}

describe("Trace full IO composition", () => {
  const io = TraceReadFullIo.create(
    TraceIOExtractionService.create(TraceCanonicalisationService.create()),
  );

  it("preserves structured recalled input and output instead of returning previews", () => {
    const input = { question: "What changed?", context: ["one", "two"] };
    const output = { answer: "The complete payload", score: 0.75 };

    const result = io.recompute([
      capturedSpan({
        "langwatch.input": input,
        "langwatch.output": output,
      }),
    ]);

    expect(result).toEqual({
      input: { type: "json", value: input },
      output: { type: "json", value: output },
    });
  });

  it("retains canonical span-name fallback when the captured span has no explicit input", () => {
    expect(io.recompute([capturedSpan({})])).toEqual({
      input: { type: "json", value: "assistant" },
      output: null,
    });
  });

  it("leaves empty traces without recomputed IO", () => {
    expect(io.recompute([])).toEqual({ input: null, output: null });
  });
});
