/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";
import type { Span } from "../../../tracer/types";
import { collectSpansFromEs } from "../es-span-collector";

// Use real JudgeSpanCollector from SDK - no mocking needed for integration tests

function createTestSpan(overrides: Partial<Span> = {}): Span {
  return {
    span_id: "abc123",
    trace_id: "trace_abc",
    type: "llm",
    name: "user-agent-call",
    timestamps: { started_at: 1000, finished_at: 2000 },
    ...overrides,
  } as Span;
}

describe("collectSpansFromEs()", () => {
  const threadId = "test-thread";
  const defaultParams = {
    traceId: "trace_abc",
    projectId: "project_123",
    threadId,
    timeoutMs: 500,
    retryIntervalMs: 50,
  };

  describe("when spans are available in ES", () => {
    it("returns a collector populated with user agent spans", async () => {
      const querySpans = vi.fn().mockResolvedValue([
        createTestSpan({ name: "my-agent-llm-call", span_id: "span1" }),
      ]);

      const collector = await collectSpansFromEs({
        ...defaultParams,
        querySpans,
      });

      const spans = collector.getSpansForThread(threadId);
      expect(spans.length).toBe(1);
      expect(spans[0]!.name).toBe("my-agent-llm-call");
    });
  });

  describe("when spans have not yet arrived", () => {
    it("retries until spans appear", async () => {
      const querySpans = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          createTestSpan({ name: "delayed-span", span_id: "span2" }),
        ]);

      const collector = await collectSpansFromEs({
        ...defaultParams,
        querySpans,
      });

      expect(querySpans).toHaveBeenCalledTimes(3);
      const spans = collector.getSpansForThread(threadId);
      expect(spans.length).toBe(1);
    });

    it("returns empty collector after timeout when no spans arrive", async () => {
      const querySpans = vi.fn().mockResolvedValue([]);

      const collector = await collectSpansFromEs({
        ...defaultParams,
        timeoutMs: 150,
        retryIntervalMs: 50,
        querySpans,
      });

      const spans = collector.getSpansForThread(threadId);
      expect(spans.length).toBe(0);
      // Verify this is a genuinely empty result, not a synthetic error span
      const hasErrorSpan = spans.some(
        (s) => s.name === "langwatch.span_collection.error",
      );
      expect(hasErrorSpan).toBe(false);
    });
  });

  describe("when ES contains infrastructure spans", () => {
    it("filters out scenario infrastructure spans", async () => {
      const querySpans = vi.fn().mockResolvedValue([
        createTestSpan({ name: "my-agent-tool-call", span_id: "user1" }),
        createTestSpan({
          name: "langwatch.scenario.run",
          span_id: "infra1",
        }),
        createTestSpan({
          name: "langwatch.judge.evaluate",
          span_id: "infra2",
        }),
        createTestSpan({
          name: "langwatch.user_simulator.generate",
          span_id: "infra3",
        }),
        createTestSpan({ name: "another-user-span", span_id: "user2" }),
      ]);

      const collector = await collectSpansFromEs({
        ...defaultParams,
        querySpans,
      });

      const spans = collector.getSpansForThread(threadId);
      expect(spans.length).toBe(2);
      expect(spans.map((s) => s.name)).toEqual([
        "my-agent-tool-call",
        "another-user-span",
      ]);
    });
  });

  describe("when ES query fails", () => {
    it("produces a collector with a synthetic error span", async () => {
      const querySpans = vi
        .fn()
        .mockRejectedValue(new Error("Connection refused"));

      const collector = await collectSpansFromEs({
        ...defaultParams,
        querySpans,
      });

      const spans = collector.getSpansForThread(threadId);
      expect(spans.length).toBe(1);
      expect(spans[0]!.name).toBe("langwatch.span_collection.error");
      expect(spans[0]!.attributes["langwatch.span_collection.error.reason"]).toBe(
        "Connection refused",
      );
    });
  });

  describe("when ES contains a realistic tool-call span with hierarchy", () => {
    it("preserves tool-call attributes and parent span through the full pipeline", async () => {
      const parentSpan = createTestSpan({
        span_id: "parent_llm_span",
        trace_id: "trace_abc",
        type: "llm",
        name: "gpt-4o",
        input: {
          type: "chat_messages",
          value: [{ role: "user", content: "What is order #1234?" }],
        },
        output: {
          type: "chat_messages",
          value: [
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_abc",
                  type: "function",
                  function: {
                    name: "lookup_order",
                    arguments: '{"order_id":"1234"}',
                  },
                },
              ],
            },
          ],
        },
      });

      const toolCallSpan = createTestSpan({
        span_id: "tool_span_1",
        parent_id: "parent_llm_span",
        trace_id: "trace_abc",
        type: "tool",
        name: "tool_call.lookup_order",
        input: {
          type: "json",
          value: { order_id: "1234" },
        },
        output: {
          type: "json",
          value: { status: "shipped", tracking: "TRACK-5678" },
        },
        timestamps: { started_at: 1500, finished_at: 1800 },
      });

      const querySpans = vi.fn().mockResolvedValue([parentSpan, toolCallSpan]);

      const collector = await collectSpansFromEs({
        ...defaultParams,
        querySpans,
      });

      const spans = collector.getSpansForThread(threadId);
      expect(spans.length).toBe(2);

      // Verify parent span
      const parent = spans.find((s) => s.name === "gpt-4o");
      expect(parent).toBeDefined();

      // Verify tool-call span preserved name, hierarchy, and attributes
      const tool = spans.find((s) => s.name === "tool_call.lookup_order");
      expect(tool).toBeDefined();
      expect(tool!.parentSpanContext?.spanId).toBe("parent_llm_span");
      expect(tool!.attributes["input"]).toBe(
        JSON.stringify({ order_id: "1234" }),
      );
      expect(tool!.attributes["output"]).toBe(
        JSON.stringify({ status: "shipped", tracking: "TRACK-5678" }),
      );
    });
  });

  describe("when timeout is reached", () => {
    it("completes with whatever was found", async () => {
      const querySpans = vi.fn().mockResolvedValue([]);

      const start = Date.now();
      const collector = await collectSpansFromEs({
        ...defaultParams,
        timeoutMs: 200,
        retryIntervalMs: 50,
        querySpans,
      });
      const elapsed = Date.now() - start;

      // Verify it didn't hang forever
      expect(elapsed).toBeLessThan(1000);
      const spans = collector.getSpansForThread(threadId);
      expect(spans.length).toBe(0);
    });
  });
});
