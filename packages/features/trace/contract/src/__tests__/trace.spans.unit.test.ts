import { describe, expect, it } from "vitest";
import { normalizedSpanSchema, NormalizedSpanKind, NormalizedStatusCode } from "../trace.spans";

describe("normalized span contract", () => {
  it("accepts the complete projected span shape", () => {
    const span = normalizedSpanSchema.parse({
      id: "span-row",
      traceId: "trace",
      spanId: "span",
      tenantId: "tenant",
      parentSpanId: null,
      parentTraceId: null,
      parentIsRemote: null,
      sampled: true,
      startTimeUnixMs: 10,
      endTimeUnixMs: 20,
      durationMs: 10,
      name: "operation",
      kind: NormalizedSpanKind.INTERNAL,
      resourceAttributes: { service: "api" },
      spanAttributes: { answer: 42 },
      events: [{ name: "event", timeUnixMs: 15, attributes: {} }],
      links: [],
      statusMessage: null,
      statusCode: NormalizedStatusCode.OK,
      instrumentationScope: { name: "sdk", version: null },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
      cost: null,
      nonBilledCost: null,
    });

    expect(span.spanAttributes.answer).toBe(42);
  });

  it("rejects non-canonical dropped-count values", () => {
    expect(() =>
      normalizedSpanSchema.parse({
        id: "span-row",
        traceId: "trace",
        spanId: "span",
        tenantId: "tenant",
        parentSpanId: null,
        parentTraceId: null,
        parentIsRemote: null,
        sampled: true,
        startTimeUnixMs: 10,
        endTimeUnixMs: 20,
        durationMs: 10,
        name: "operation",
        kind: NormalizedSpanKind.INTERNAL,
        resourceAttributes: {},
        spanAttributes: {},
        events: [],
        links: [],
        statusMessage: null,
        statusCode: null,
        instrumentationScope: { name: "sdk", version: null },
        droppedAttributesCount: 1,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
        cost: null,
        nonBilledCost: null,
      }),
    ).toThrow();
  });
});
