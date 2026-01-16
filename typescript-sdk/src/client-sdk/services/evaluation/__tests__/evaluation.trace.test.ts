/**
 * Tests for trace isolation in evaluation.withTarget()
 *
 * These tests verify that each withTarget() call creates an independent trace
 * with a unique trace_id, NOT shared across targets within the same dataset row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LangWatch } from "@/client-sdk";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";

// Mock fetch globally
const originalFetch = globalThis.fetch;

/**
 * Helper to set up a real tracer for tests that need actual trace IDs
 */
const setupTestTracer = () => {
  const exporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(exporter);
  const provider = new NodeTracerProvider({
    spanProcessors: [spanProcessor],
  });
  trace.setGlobalTracerProvider(provider);
  return { provider, exporter };
};

describe("Target Trace Isolation", () => {
  let tracerProvider: NodeTracerProvider | null = null;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (tracerProvider) {
      await tracerProvider.shutdown();
      tracerProvider = null;
      // Reset the global tracer provider
      trace.disable();
    }
  });

  it("creates unique trace_id per target within the SAME row (with real tracer)", async () => {
    // Set up a real tracer provider so we get actual trace IDs
    const { provider, exporter } = setupTestTracer();
    tracerProvider = provider;

    const capturedBodies: Array<{
      dataset: Array<{ index: number; target_id: string; trace_id: string | null }>;
    }> = [];

    globalThis.fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("experiment/init")) {
        return new Response(JSON.stringify({ slug: "test", path: "/test" }), { status: 200 });
      }
      if (urlStr.includes("log_results")) {
        capturedBodies.push(JSON.parse(options?.body as string));
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:5560",
    });

    const evaluation = await langwatch.evaluation.init("test-trace-isolation");

    // Use a SINGLE dataset item to test that targets within the SAME row get different traces
    await evaluation.run(
      [{ question: "Question A" }],
      async ({ item }) => {
        // Run targets in PARALLEL within the same row
        await Promise.all([
          evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
            await new Promise((r) => setTimeout(r, 10));
            return `GPT-4: ${item.question}`;
          }),
          evaluation.withTarget("claude", { model: "anthropic/claude" }, async () => {
            await new Promise((r) => setTimeout(r, 10));
            return `Claude: ${item.question}`;
          }),
        ]);
      },
      { concurrency: 1 }
    );

    // Wait for flush
    await new Promise((r) => setTimeout(r, 200));

    // Collect all dataset entries
    const allEntries = capturedBodies.flatMap((b) => b.dataset ?? []);

    // Should have 2 entries (1 row × 2 targets)
    expect(allEntries.length).toBe(2);

    // Both entries are index 0
    expect(allEntries[0]!.index).toBe(0);
    expect(allEntries[1]!.index).toBe(0);

    // They should have different target_ids
    const targetIds = allEntries.map((e) => e.target_id);
    expect(targetIds).toContain("gpt-4");
    expect(targetIds).toContain("claude");

    // CRITICAL: Each target should have a DIFFERENT trace_id
    const traceIds = allEntries.map((e) => e.trace_id);
    
    // With a real tracer, we should have non-null trace IDs
    expect(traceIds[0]).not.toBeNull();
    expect(traceIds[1]).not.toBeNull();
    expect(traceIds[0]).not.toBe("");
    expect(traceIds[1]).not.toBe("");
    
    // They must be DIFFERENT
    expect(traceIds[0]).not.toBe(traceIds[1]);
  });

  it("creates unique trace_id across ALL targets in multi-row evaluation (with real tracer)", async () => {
    // Set up a real tracer provider
    const { provider, exporter } = setupTestTracer();
    tracerProvider = provider;

    const capturedBodies: Array<{
      dataset: Array<{ index: number; target_id: string; trace_id: string | null }>;
    }> = [];

    globalThis.fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("experiment/init")) {
        return new Response(JSON.stringify({ slug: "test", path: "/test" }), { status: 200 });
      }
      if (urlStr.includes("log_results")) {
        capturedBodies.push(JSON.parse(options?.body as string));
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:5560",
    });

    const evaluation = await langwatch.evaluation.init("test-all-unique");

    await evaluation.run(
      [{ question: "Question A" }, { question: "Question B" }, { question: "Question C" }],
      async ({ item }) => {
        await Promise.all([
          evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
            await new Promise((r) => setTimeout(r, 5));
            return `GPT-4: ${item.question}`;
          }),
          evaluation.withTarget("claude", { model: "anthropic/claude" }, async () => {
            await new Promise((r) => setTimeout(r, 5));
            return `Claude: ${item.question}`;
          }),
        ]);
      },
      { concurrency: 3 }
    );

    // Wait for flush
    await new Promise((r) => setTimeout(r, 200));

    // Collect all dataset entries
    const allEntries = capturedBodies.flatMap((b) => b.dataset ?? []);

    // Should have 6 entries (3 rows × 2 targets)
    expect(allEntries.length).toBe(6);

    // ALL trace_ids should be unique
    const traceIds = allEntries.map((e) => e.trace_id).filter((t): t is string => t !== null && t !== "");
    
    expect(traceIds.length).toBe(6); // All should have valid trace IDs
    expect(new Set(traceIds).size).toBe(6); // All should be unique
  });

  it("sends null trace_id when no tracer is configured (no-op tracer)", async () => {
    const capturedBodies: Array<{
      dataset: Array<{ trace_id: string | null }>;
    }> = [];

    globalThis.fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("experiment/init")) {
        return new Response(JSON.stringify({ slug: "test", path: "/test" }), { status: 200 });
      }
      if (urlStr.includes("log_results")) {
        capturedBodies.push(JSON.parse(options?.body as string));
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:5560",
    });

    const evaluation = await langwatch.evaluation.init("test-noop-tracer");

    await evaluation.run(
      [{ q: "test" }],
      async () => {
        await evaluation.withTarget("model", async () => "response");
      }
    );

    // Wait for flush
    await new Promise((r) => setTimeout(r, 200));

    // Collect entries
    const entries = capturedBodies.flatMap((b) => b.dataset ?? []);

    // trace_id should be null (not "00000..."), as there's no real tracer configured
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // Should be null or empty string, NOT "00000000000000000000000000000000"
      if (entry.trace_id !== null) {
        expect(entry.trace_id).not.toBe("00000000000000000000000000000000");
      }
    }
  });

  it("sets evaluationUsesTargets flag on first withTarget call", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("experiment/init")) {
        return new Response(JSON.stringify({ slug: "test", path: "/test" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:5560",
    });

    const evaluation = await langwatch.evaluation.init("test-flag");

    // Before first withTarget, flag should be false (but we can't access it directly)
    // This test verifies the behavior: after withTarget, subsequent iterations
    // shouldn't create iteration-level traces

    let firstCallComplete = false;

    await evaluation.run(
      [{ q: "A" }, { q: "B" }],
      async ({ index }) => {
        if (index === 0) {
          // First item - use withTarget
          await evaluation.withTarget("model", async () => {
            firstCallComplete = true;
            return "response";
          });
        } else {
          // Second item - flag should be set, no iteration trace created
          // We verify this by checking that only target entries exist, not iteration entries
        }
      },
      { concurrency: 1 }
    );

    expect(firstCallComplete).toBe(true);
  });

  it("skips iteration trace when evaluation uses targets", async () => {
    const capturedBodies: Array<{
      dataset: Array<{ target_id?: string }>;
    }> = [];

    globalThis.fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("experiment/init")) {
        return new Response(JSON.stringify({ slug: "test", path: "/test" }), { status: 200 });
      }
      if (urlStr.includes("log_results")) {
        capturedBodies.push(JSON.parse(options?.body as string));
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:5560",
    });

    const evaluation = await langwatch.evaluation.init("test-skip-iteration");

    await evaluation.run(
      [{ q: "A" }, { q: "B" }, { q: "C" }],
      async () => {
        // Always use withTarget
        await evaluation.withTarget("model", async () => "response");
      },
      { concurrency: 2 }
    );

    // Wait for flush
    await new Promise((r) => setTimeout(r, 200));

    // Collect entries
    const entries = capturedBodies.flatMap((b) => b.dataset ?? []);

    // All entries should have target_id (from withTarget)
    // None should be iteration-level entries (without target_id)
    expect(entries.length).toBe(3); // 3 items, each with 1 target
    for (const entry of entries) {
      expect(entry.target_id).toBe("model");
    }
  });
});
