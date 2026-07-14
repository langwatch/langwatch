/**
 * Tests that langwatch.origin is set on evaluation spans and that
 * child spans created inside the evaluation callback are properly
 * parented under the evaluation.iteration span.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LangWatch } from "@/client-sdk";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-node";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

const originalFetch = globalThis.fetch;

const setupTestTracer = () => {
  const exporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(exporter);
  const provider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
  });
  // Register context manager for async context propagation (parent-child spans)
  const contextManager = new AsyncLocalStorageContextManager();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
  return { provider, exporter };
};

const mockFetch = () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (urlStr.includes("experiment/init")) {
      return new Response(JSON.stringify({ slug: "test", path: "/test" }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
};

describe("Experiment origin and span parenting", () => {
  let tracerProvider: NodeTracerProvider | null = null;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (tracerProvider) {
      await tracerProvider.shutdown();
      tracerProvider = null;
      context.disable();
      trace.disable();
    }
  });

  describe("when running evaluation.run() without targets", () => {
    it("sets langwatch.origin on the evaluation.iteration span", async () => {
      const { provider, exporter } = setupTestTracer();
      tracerProvider = provider;
      mockFetch();

      const langwatch = new LangWatch({
        apiKey: "test-key",
        endpoint: "http://localhost:5560",
      });

      const evaluation = await langwatch.experiments.init("test-origin");

      await evaluation.run(
        [{ question: "What is 2+2?" }],
        async ({ index }) => {
          evaluation.log("metric", { index, score: 1.0 });
        },
        { concurrency: 1 }
      );

      await new Promise((r) => setTimeout(r, 100));

      const spans = exporter.getFinishedSpans();
      const iterationSpan = spans.find(
        (s) => s.name === "evaluation.iteration"
      );

      expect(iterationSpan).toBeDefined();
      expect(iterationSpan!.attributes["langwatch.origin"]).toBe("evaluation");
      expect(iterationSpan!.attributes["evaluation.run_id"]).toBeDefined();
    });

    it("parents child spans under evaluation.iteration", async () => {
      const { provider, exporter } = setupTestTracer();
      tracerProvider = provider;
      mockFetch();

      const langwatch = new LangWatch({
        apiKey: "test-key",
        endpoint: "http://localhost:5560",
      });

      const evaluation = await langwatch.experiments.init("test-parenting");
      const tracer = trace.getTracer("langwatch");

      await evaluation.run(
        [{ question: "What is 2+2?" }],
        async () => {
          // Simulate an instrumented LLM call inside the evaluation callback
          await tracer.startActiveSpan("llm.call", async (span) => {
            try {
              await new Promise((r) => setTimeout(r, 10));
              span.setAttribute("llm.response", "4");
            } finally {
              span.end();
            }
          });
        },
        { concurrency: 1 }
      );

      await new Promise((r) => setTimeout(r, 100));

      const spans = exporter.getFinishedSpans();
      const iterationSpan = spans.find(
        (s) => s.name === "evaluation.iteration"
      );
      const childSpan = spans.find((s) => s.name === "llm.call");

      expect(iterationSpan).toBeDefined();
      expect(childSpan).toBeDefined();

      // Child span shares the same trace_id
      expect(childSpan!.spanContext().traceId).toBe(
        iterationSpan!.spanContext().traceId
      );

      // Child span's parent is the iteration span
      expect((childSpan as any).parentSpanContext.spanId).toBe(
        iterationSpan!.spanContext().spanId
      );
    });
  });

  describe("when running evaluation.withTarget()", () => {
    it("sets langwatch.origin on the target span", async () => {
      const { provider, exporter } = setupTestTracer();
      tracerProvider = provider;
      mockFetch();

      const langwatch = new LangWatch({
        apiKey: "test-key",
        endpoint: "http://localhost:5560",
      });

      const evaluation = await langwatch.experiments.init("test-target-origin");

      await evaluation.run(
        [{ question: "What is 2+2?" }],
        async () => {
          await evaluation.withTarget("gpt-4", async () => {
            await new Promise((r) => setTimeout(r, 10));
            return "4";
          });
        },
        { concurrency: 1 }
      );

      await new Promise((r) => setTimeout(r, 100));

      const spans = exporter.getFinishedSpans();
      const targetSpan = spans.find((s) =>
        s.name.startsWith("evaluation.target.")
      );

      expect(targetSpan).toBeDefined();
      expect(targetSpan!.attributes["langwatch.origin"]).toBe("evaluation");
      expect(targetSpan!.attributes["evaluation.target"]).toBe("gpt-4");
    });

    it("parents child spans under the target span", async () => {
      const { provider, exporter } = setupTestTracer();
      tracerProvider = provider;
      mockFetch();

      const langwatch = new LangWatch({
        apiKey: "test-key",
        endpoint: "http://localhost:5560",
      });

      const evaluation = await langwatch.experiments.init(
        "test-target-parenting"
      );
      const tracer = trace.getTracer("langwatch");

      await evaluation.run(
        [{ question: "What is 2+2?" }],
        async () => {
          await evaluation.withTarget("gpt-4", async () => {
            await tracer.startActiveSpan("llm.call", async (span) => {
              try {
                await new Promise((r) => setTimeout(r, 10));
              } finally {
                span.end();
              }
            });
            return "4";
          });
        },
        { concurrency: 1 }
      );

      await new Promise((r) => setTimeout(r, 100));

      const spans = exporter.getFinishedSpans();
      const targetSpan = spans.find((s) =>
        s.name.startsWith("evaluation.target.")
      );
      const childSpan = spans.find((s) => s.name === "llm.call");

      expect(targetSpan).toBeDefined();
      expect(childSpan).toBeDefined();

      expect(childSpan!.spanContext().traceId).toBe(
        targetSpan!.spanContext().traceId
      );
      expect((childSpan as any).parentSpanContext.spanId).toBe(
        targetSpan!.spanContext().spanId
      );
    });
  });
});
