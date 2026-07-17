/**
 * @vitest-environment node
 *
 * Regression guard for the per-job root-trace scoping fix.
 *
 * The event-sourcing queue workers used to run each job inside the originating
 * command's (remote) span context, so every job a single command produced
 * accreted into one shared trace. A high-fan-out command (e.g. an OTLP ingest
 * with hundreds of thousands of spans) collapsed into a single ~6-minute,
 * empty-root mega-trace that OOM-crash-looped the self-observability collector.
 *
 * The fix roots the per-job span (`root: true`) so each job is its own bounded
 * trace regardless of the ambient context. This test proves that invariant on
 * the in-memory queue (the Redis-free path that shares the exact same
 * `withActiveSpan(..., { root: true }, ...)` call), using a real
 * TracerProvider + in-memory exporter.
 */
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

import type { EventSourcedQueueDefinition } from "../../queues";
import { EventSourcedQueueProcessorMemory } from "../memory";

describe("EventSourcedQueueProcessorMemory root-trace scoping", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });

  afterEach(() => {
    exporter.reset();
  });

  it("processes each job as its own root trace even inside an active parent span", async () => {
    const processor = new EventSourcedQueueProcessorMemory<{ id: string }>({
      name: "test-queue",
      process: vi.fn().mockResolvedValue(void 0),
    } as EventSourcedQueueDefinition<{ id: string }>);

    // Simulate the originating command / request context: an active span whose
    // trace the job must NOT be pulled into.
    const ambientTracer = trace.getTracer("test-ambient");
    const ambientTraceId = await ambientTracer.startActiveSpan(
      "originating-command",
      async (ambient) => {
        try {
          await processor.send({ id: "job-1" });
          return ambient.spanContext().traceId;
        } finally {
          ambient.end();
        }
      },
    );

    const jobSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === "pipeline.process");

    expect(jobSpan).toBeDefined();
    // Root span: no parent, and a brand-new trace id distinct from the
    // originating command's trace — never accreting into a shared trace.
    expect(jobSpan!.parentSpanContext).toBeUndefined();
    expect(jobSpan!.spanContext().traceId).not.toBe(ambientTraceId);
  });

  it("gives sibling jobs from the same parent independent traces", async () => {
    const processor = new EventSourcedQueueProcessorMemory<{ id: string }>({
      name: "test-queue",
      process: vi.fn().mockResolvedValue(void 0),
    } as EventSourcedQueueDefinition<{ id: string }>);

    const ambientTracer = trace.getTracer("test-ambient");
    await ambientTracer.startActiveSpan("originating-command", async (ambient) => {
      try {
        await processor.send({ id: "job-a" });
        await processor.send({ id: "job-b" });
      } finally {
        ambient.end();
      }
    });

    const jobTraceIds = exporter
      .getFinishedSpans()
      .filter((span) => span.name === "pipeline.process")
      .map((span) => span.spanContext().traceId);

    expect(jobTraceIds).toHaveLength(2);
    // Two jobs from the same originating context land in two distinct traces,
    // rather than piling into one unbounded mega-trace.
    expect(new Set(jobTraceIds).size).toBe(2);
  });
});
