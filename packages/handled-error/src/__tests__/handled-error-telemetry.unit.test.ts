/**
 * @see specs/features/domain-error-contract.feature
 */
import { trace, TraceFlags } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "../handled-error.ts";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";

describe("given a handled error constructed inside an active span", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "Telemetry is captured from the active span" */
  it("carries that span's trace and span ids, and hands the trace id to the client", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(
      trace.wrapSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.SAMPLED }),
    );

    const error = new NotFoundError("evaluation_not_found", "Evaluation", "eval-1");

    expect(error.traceId).toBe(TRACE_ID);
    expect(error.spanId).toBe(SPAN_ID);
    expect(error.serialize()).toMatchObject({ traceId: TRACE_ID });
  });

  /** @scenario "Telemetry is captured from the active span" */
  it("carries no ids when no span is active", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(undefined);

    const error = new NotFoundError("evaluation_not_found", "Evaluation", "eval-1");

    expect(error.traceId).toBeUndefined();
    expect(error.spanId).toBeUndefined();
  });
});
