/**
 * @vitest-environment jsdom
 *
 * Proves a captured error names the trace it happened in, so an exception in
 * PostHog can be followed to the request that caused it instead of being joined
 * by eyeballing timestamps.
 *
 * Exercises the browser capture path. The server path reaches its client
 * through a `new Function("return require(...)")` indirection — deliberate, to
 * keep posthog-node out of the client bundle — which no module mock can
 * intercept, so it is verified against the running stack rather than here. Both
 * paths assemble properties from the same code.
 *
 * Binds the scenarios `An error captured in the browser carries its trace` and
 * `An error captured outside any call records no trace` in
 * specs/observability/browser-rum-trace-correlation.feature. See ADR-058.
 */
import { context, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();

vi.mock("posthog-js", () => ({
  default: { __loaded: true, capture },
}));

const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
});

/** `posthog.capture(event, properties)` — properties are the second argument. */
const propertiesOfLastCapture = () =>
  capture.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;

describe("captureException trace context", () => {
  beforeAll(() => {
    // A provider alone does not make `trace.getActiveSpan()` work: without a
    // context manager the active context is never propagated into the callback,
    // and every assertion here would fail for that reason rather than the one
    // being tested. The browser SDK registers the same manager.
    context.setGlobalContextManager(new StackContextManager().enable());
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  beforeEach(() => {
    capture.mockClear();
  });

  describe("given an error captured inside a span", () => {
    /** @scenario An error captured in the browser carries its trace */
    it("records the trace and span it happened in", async () => {
      const { captureException } = await import("../posthogErrorCapture");

      const span = trace
        .getTracer("test")
        .startActiveSpan("handling a call", (started) => {
          captureException(new Error("boom"));
          started.end();
          return started;
        });

      const spanContext = span.spanContext();
      expect(propertiesOfLastCapture()).toMatchObject({
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
      });
    });

    it("cannot have its trace identity overwritten by caller-supplied extras", async () => {
      const { captureException } = await import("../posthogErrorCapture");

      const span = trace
        .getTracer("test")
        .startActiveSpan("handling a call", (started) => {
          captureException(new Error("boom"), {
            extra: { trace_id: "caller-supplied" },
          });
          started.end();
          return started;
        });

      expect(propertiesOfLastCapture()?.trace_id).toBe(
        span.spanContext().traceId,
      );
    });
  });

  describe("given an error captured outside any span", () => {
    /** @scenario An error captured outside any call records no trace */
    it("is still recorded, and claims no trace", async () => {
      const { captureException } = await import("../posthogErrorCapture");

      captureException(new Error("boom during boot"));

      const properties = propertiesOfLastCapture();
      expect(properties).toMatchObject({
        $exception_message: "boom during boot",
      });
      expect(properties).not.toHaveProperty("trace_id");
      expect(properties).not.toHaveProperty("span_id");
    });
  });
});
