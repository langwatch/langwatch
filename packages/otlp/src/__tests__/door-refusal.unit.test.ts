/** @vitest-environment node */

import { HandledError } from "@langwatch/handled-error";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { type Span, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordIngestDoorRefusal,
  resetIngestDoorRefusalLog,
  withClientFaultSpan,
} from "../door.ts";

class Refused extends HandledError {
  declare readonly code: "invalid_credentials";

  constructor() {
    super("invalid_credentials", "Invalid API key", { httpStatus: 401, fault: "customer" });
  }
}

const refusal = () => new Refused();

const diagnostics = {
  path: "/api/otel/v1/traces",
  method: "POST",
  userAgent: "exporter/1",
  traceparent: null,
  clientAddress: "203.0.113.9",
  hasEmptyAuthToken: false,
};

describe("recordIngestDoorRefusal", () => {
  let metrics = createRecordingMeterProvider();
  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    resetIngestDoorRefusalLog();
    metrics.install();
  });
  afterEach(() => metrics.uninstall());

  describe("when one caller is refused repeatedly", () => {
    /** @scenario A refused ingest export warns once a minute per caller */
    it("warns once per window with the held-back count and counts every refusal", () => {
      const logger = { warn: vi.fn(), debug: vi.fn() };
      const record = (now: number) =>
        recordIngestDoorRefusal({
          logger,
          signal: "traces",
          error: refusal(),
          diagnostics,
          now,
        });

      record(0);
      record(1_000);
      record(2_000);
      record(61_000);

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenCalledTimes(2);
      expect(logger.warn.mock.calls[1]?.[0]).toMatchObject({ suppressedRefusals: 2 });
      expect(
        metrics.valueOf("langwatch_ingest_door_refusals_total", {
          signal: "traces",
          code: "invalid_credentials",
          status: 401,
        }),
      ).toBe(4);
      const labelSets = metrics.recorded
        .filter((write) => write.instrument === "langwatch_ingest_door_refusals_total")
        .map((write) => write.attributes);
      // The whole label set, so no tenant, key or token rides along.
      const only = { signal: "traces", code: "invalid_credentials", status: 401 };
      expect(labelSets).toEqual([only, only, only, only]);
    });
  });

  describe("when two callers share a user agent", () => {
    /** @scenario A refused ingest export warns once a minute per caller */
    it("warns for each caller address on its own", () => {
      const logger = { warn: vi.fn(), debug: vi.fn() };
      for (const clientAddress of ["203.0.113.9", "198.51.100.4"]) {
        recordIngestDoorRefusal({
          logger,
          signal: "traces",
          error: refusal(),
          diagnostics: { ...diagnostics, clientAddress },
          now: 0,
        });
      }

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });
});

describe("withClientFaultSpan", () => {
  /** A real tracer, so the asserted status is what the SDK records, not what a double claims. */
  const exporter = new InMemorySpanExporter();
  const tracer = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }).getTracer("door-refusal-test");
  const open = <T>(run: (span: Span) => Promise<T>) => tracer.startActiveSpan("receiver", run);
  const recorded = () => {
    const [span, ...others] = exporter.getFinishedSpans();
    if (!span || others.length > 0) throw new Error("expected exactly one finished span");
    return span;
  };

  afterEach(() => exporter.reset());

  /** @scenario An OTLP receiver span stays unset for a caller fault */
  it("rethrows a customer fault with the span left unset and the exception recorded", async () => {
    const error = refusal();

    await expect(withClientFaultSpan(open, () => Promise.reject(error))).rejects.toBe(error);

    const span = recorded();
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.events.map((event) => event.name)).toEqual(["exception"]);
    expect(span.attributes).toMatchObject({
      "langwatch.error.code": "invalid_credentials",
      "langwatch.error.fault": "customer",
    });
  });

  /** @scenario An OTLP receiver span still records any other failure as ERROR */
  it("marks any other failure ERROR with its message", async () => {
    const error = new Error("boom");

    await expect(withClientFaultSpan(open, () => Promise.reject(error))).rejects.toBe(error);

    expect(recorded().status).toEqual({ code: SpanStatusCode.ERROR, message: "boom" });
  });

  it("returns the body's value with the span ended and its status left unset", async () => {
    await expect(withClientFaultSpan(open, () => Promise.resolve(7))).resolves.toBe(7);

    expect(recorded().status.code).toBe(SpanStatusCode.UNSET);
  });
});
