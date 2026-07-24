/**
 * @vitest-environment node
 */

import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { createSyntheticErrorSpan } from "../synthetic-error-span";

describe("createSyntheticErrorSpan()", () => {
  it("creates a span named 'langwatch.span_collection.error'", () => {
    const span = createSyntheticErrorSpan({
      traceId: "trace_abc",
      reason: "Connection refused",
    });

    expect(span.name).toBe("langwatch.span_collection.error");
  });

  it("sets error status with the failure reason", () => {
    const span = createSyntheticErrorSpan({
      traceId: "trace_abc",
      reason: "Timeout after 10s",
    });

    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("Timeout after 10s");
  });

  it("includes the failure reason in attributes", () => {
    const span = createSyntheticErrorSpan({
      traceId: "trace_abc",
      reason: "ES cluster unavailable",
    });

    expect(span.attributes["langwatch.span_collection.error"]).toBe(true);
    expect(span.attributes["langwatch.span_collection.error.reason"]).toBe(
      "ES cluster unavailable",
    );
  });

  it("uses the provided trace ID in span context", () => {
    const span = createSyntheticErrorSpan({
      traceId: "abcdef1234567890abcdef1234567890",
      reason: "test",
    });

    expect(span.spanContext().traceId).toBe(
      "abcdef1234567890abcdef1234567890",
    );
  });

  it("is an INTERNAL span kind", () => {
    const span = createSyntheticErrorSpan({
      traceId: "trace_abc",
      reason: "test",
    });

    expect(span.kind).toBe(SpanKind.INTERNAL);
  });

  it("is marked as ended", () => {
    const span = createSyntheticErrorSpan({
      traceId: "trace_abc",
      reason: "test",
    });

    expect(span.ended).toBe(true);
  });
});
