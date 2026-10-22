/** @vitest-environment node */

import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectInvalidCredentialsError } from "../../errors.ts";
import {
  isClientFault,
  recordRequestSpanFailure,
  resetClientFaultLog,
  sampleClientFaultLog,
} from "../client-fault-telemetry.ts";

function fakeSpan() {
  const span = {
    recordException: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
  };
  return { span, asSpan: span as unknown as Span };
}

describe("recordRequestSpanFailure", () => {
  describe("when the caller's credential is refused", () => {
    it("keeps the exception and leaves the span status unset", () => {
      const { span, asSpan } = fakeSpan();
      const error = new ProjectInvalidCredentialsError();

      recordRequestSpanFailure({ span: asSpan, error });

      expect(span.recordException).toHaveBeenCalledWith(error);
      expect(span.setAttributes).toHaveBeenCalledWith({
        "langwatch.error.code": "invalid_credentials",
        "langwatch.error.fault": "customer",
      });
      expect(span.setStatus).not.toHaveBeenCalled();
    });
  });

  describe("when a request is answered 413 by the framework", () => {
    it("treats it as the caller's fault", () => {
      const { span, asSpan } = fakeSpan();

      recordRequestSpanFailure({
        span: asSpan,
        error: Object.assign(new Error("Payload Too Large"), { status: 413 }),
      });

      expect(span.setStatus).not.toHaveBeenCalled();
    });
  });

  describe("when the server fails", () => {
    it("marks the span ERROR and carries the cause in the status message", () => {
      const { span, asSpan } = fakeSpan();

      recordRequestSpanFailure({ span: asSpan, error: new Error("clickhouse down") });

      expect(span.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "clickhouse down",
      });
    });
  });
});

describe("isClientFault", () => {
  it("is true for a customer-fault handled error and false for a bare error", () => {
    expect(isClientFault(new ProjectInvalidCredentialsError())).toBe(true);
    expect(isClientFault(new Error("boom"))).toBe(false);
  });
});

describe("sampleClientFaultLog", () => {
  let metrics = createRecordingMeterProvider();

  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    resetClientFaultLog();
    metrics.install();
  });

  afterEach(() => metrics.uninstall());

  describe("when the same refusal repeats inside one window", () => {
    it("warns once, demotes the repeats to debug, and counts every one", () => {
      const error = new ProjectInvalidCredentialsError();
      const sample = (now: number) =>
        sampleClientFaultLog({ error, family: "otel", statusCode: 401, now });

      expect(sample(0)).toEqual({ level: "warn", suppressedRequests: 0 });
      expect(sample(1_000)?.level).toBe("debug");
      expect(sample(2_000)?.level).toBe("debug");
      expect(sample(61_000)).toEqual({ level: "warn", suppressedRequests: 2 });

      expect(
        metrics.valueOf("langwatch_http_client_fault_requests_total", {
          family: "otel",
          code: "invalid_credentials",
          status: 401,
        }),
      ).toBe(4);
    });
  });

  describe("when the failure is a server error", () => {
    it("is left to the default logging and is not counted", () => {
      expect(
        sampleClientFaultLog({ error: new Error("boom"), family: "otel", statusCode: 500 }),
      ).toBeUndefined();
      expect(metrics.valueOf("langwatch_http_client_fault_requests_total")).toBe(0);
    });
  });
});
