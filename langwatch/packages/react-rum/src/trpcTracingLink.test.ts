/**
 * @vitest-environment jsdom
 *
 * The link exists so a procedure call is visible as its own span *inside* the
 * caller's trace. A span that is merely created is not enough — if it is not
 * active while the transport runs, the fetch instrumentation underneath starts
 * a separate trace and the call is orphaned. These tests observe the active
 * context the transport actually sees, which is the only thing that determines
 * that.
 */
import { context, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tracingLink } from "./trpcTracingLink";

const exporter = new InMemorySpanExporter();

const operation = {
  id: 1,
  type: "query" as const,
  path: "dataset.getAll",
  input: void 0,
  context: {},
  signal: null,
};

/** Runs the link over a transport we control, returning what it observed. */
function callThrough({
  transport,
}: {
  transport: (seen: { activeTraceId?: string; activeSpanId?: string }) => any;
}) {
  const seen: { activeTraceId?: string; activeSpanId?: string } = {};
  const link = tracingLink()({} as any);
  return {
    seen,
    observable: link({
      op: operation as any,
      next: () =>
        observable((observer: any) => {
          const active = trace.getActiveSpan()?.spanContext();
          seen.activeTraceId = active?.traceId;
          seen.activeSpanId = active?.spanId;
          return transport(observer);
        }) as any,
    } as any),
  };
}

describe("given a tRPC call travelling through the tracing link", () => {
  beforeEach(() => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(new StackContextManager().enable());
  });

  afterEach(() => {
    exporter.reset();
    trace.disable();
    context.disable();
  });

  describe("when the transport runs", () => {
    it("sees the procedure span as the active one", () => {
      const { seen, observable: result } = callThrough({
        transport: (observer) => {
          observer.complete();
          return () => void 0;
        },
      });
      result.subscribe({});

      const [span] = exporter.getFinishedSpans();
      expect(span?.name).toBe("trpc.dataset.getAll");
      // Same span id, so anything the transport starts descends from this call
      // rather than rooting a trace of its own.
      expect(seen.activeSpanId).toBe(span?.spanContext().spanId);
      expect(seen.activeTraceId).toBe(span?.spanContext().traceId);
    });
  });

  describe("when the call is made inside an existing span", () => {
    it("joins that trace rather than starting a new one", () => {
      const parent = trace.getTracer("test").startSpan("click");
      let observed: string | undefined;
      context.with(trace.setSpan(context.active(), parent), () => {
        const { observable: result } = callThrough({
          transport: (observer) => {
            observer.complete();
            return () => void 0;
          },
        });
        result.subscribe({});
        observed = parent.spanContext().traceId;
      });
      parent.end();

      const call = exporter
        .getFinishedSpans()
        .find((s) => s.name === "trpc.dataset.getAll");
      expect(call?.spanContext().traceId).toBe(observed);
      expect(call?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    });
  });

  describe("when the caller unsubscribes before the call completes", () => {
    it("still ends the span", () => {
      const { observable: result } = callThrough({
        transport: () => () => void 0,
      });
      const subscription = result.subscribe({});
      expect(exporter.getFinishedSpans()).toHaveLength(0);

      subscription.unsubscribe();

      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });
  });

  describe("when the call errors", () => {
    it("ends the span exactly once and lets the error through", () => {
      const errors: unknown[] = [];
      const { observable: result } = callThrough({
        transport: (observer) => {
          observer.error(new Error("nope"));
          return () => void 0;
        },
      });
      result.subscribe({ error: (e: unknown) => errors.push(e) });

      expect(errors).toHaveLength(1);
      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });
  });
});
