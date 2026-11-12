/** @vitest-environment node */

import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectInvalidCredentialsError } from "../../errors.ts";
import {
  recordRequestSpanFailure,
  resetClientFaultLog,
  sampleClientFaultLog,
} from "../client-fault-telemetry.ts";

/** A real tracer, so the asserted status is what the SDK records, not what a double claims. */
const exporter = new InMemorySpanExporter();
const tracer = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
}).getTracer("client-fault-telemetry-test");

function recordedFailure({ error, answeredStatus }: { error: unknown; answeredStatus?: number }) {
  exporter.reset();
  const span = tracer.startSpan("request");
  recordRequestSpanFailure({ span, error, answeredStatus });
  span.end();
  const [finished, ...others] = exporter.getFinishedSpans();
  if (!finished || others.length > 0) throw new Error("expected exactly one finished span");
  return finished;
}

describe("recordRequestSpanFailure", () => {
  describe("when the caller's credential is refused", () => {
    /** @scenario A refused credential leaves the request span unset */
    it("keeps the exception and leaves the span status unset", () => {
      const span = recordedFailure({ error: new ProjectInvalidCredentialsError() });

      expect(span.events.map((event) => event.name)).toEqual(["exception"]);
      expect(span.attributes).toMatchObject({
        "langwatch.error.code": "invalid_credentials",
        "langwatch.error.fault": "customer",
      });
      expect(span.status.code).toBe(SpanStatusCode.UNSET);
    });
  });

  describe("when a request is answered 413 by the framework", () => {
    /** @scenario A 4xx the framework answers is the caller's fault */
    it("treats it as the caller's fault", () => {
      const span = recordedFailure({
        error: Object.assign(new Error("Payload Too Large"), { status: 413 }),
      });

      expect(span.status.code).toBe(SpanStatusCode.UNSET);
      expect(span.attributes["langwatch.error.code"]).toBe("http_413");
    });
  });

  describe("when a thrown 4xx value is answered as a 500", () => {
    it("marks the span ERROR", () => {
      const span = recordedFailure({ error: { status: 404 }, answeredStatus: 500 });

      expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
    });
  });

  describe("when a customer-fault error is answered as a 5xx", () => {
    it("marks the span ERROR", () => {
      const span = recordedFailure({
        error: new ProjectInvalidCredentialsError(),
        answeredStatus: 503,
      });

      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.attributes["langwatch.error.fault"]).toBeUndefined();
    });
  });

  describe("when the server fails", () => {
    /** @scenario A server fault marks the span ERROR with its cause */
    it("marks the span ERROR and carries the cause in the status message", () => {
      const span = recordedFailure({ error: new Error("clickhouse down") });

      expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: "clickhouse down" });
    });
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
    /** @scenario A repeated caller fault warns once a minute and counts every request */
    it("keeps the first, demotes the repeats to debug, and counts every one", () => {
      const error = new ProjectInvalidCredentialsError();
      const sample = (now: number) =>
        sampleClientFaultLog({ error, family: "otel", statusCode: 401, now });

      expect(sample(0)).toEqual({ isRepeat: false, suppressedRequests: 0 });
      expect(sample(1_000)?.isRepeat).toBe(true);
      expect(sample(2_000)?.isRepeat).toBe(true);
      expect(sample(61_000)).toEqual({ isRepeat: false, suppressedRequests: 2 });

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
    /** @scenario A server fault is not counted as a caller fault */
    it("is left to the default logging and is not counted", () => {
      expect(
        sampleClientFaultLog({ error: new Error("boom"), family: "otel", statusCode: 500 }),
      ).toBeUndefined();
      expect(metrics.valueOf("langwatch_http_client_fault_requests_total")).toBe(0);
    });
  });
});
