import { describe, expect, it } from "vitest";
import type { SpanSummaryRow } from "~/server/app-layer/traces/repositories/span-storage.repository";
import { mapSpanSummaryPage } from "../tracesV2";

const row = (
  spanId: string,
  startTimeMs: number,
  updatedAtMs = startTimeMs,
): SpanSummaryRow => ({
  spanId,
  parentSpanId: null,
  spanName: spanId,
  durationMs: 1,
  statusCode: null,
  spanType: null,
  toolName: null,
  requestId: null,
  querySource: null,
  toolUseId: null,
  model: null,
  cost: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  startTimeMs,
  updatedAtMs,
});

describe("mapSpanSummaryPage", () => {
  it("preserves the complete public node shape", () => {
    const page = mapSpanSummaryPage({
      rows: [
        {
          spanId: "span-1",
          parentSpanId: "parent-1",
          spanName: "tool call",
          durationMs: 25,
          statusCode: 2,
          spanType: "tool",
          toolName: "search",
          requestId: "request-1",
          querySource: "source-1",
          toolUseId: "tool-use-1",
          model: "gpt-5",
          cost: 0.0125,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 10,
          startTimeMs: 1_000,
          updatedAtMs: 2_000,
        },
      ],
      hasMore: false,
    });

    expect(page).toEqual({
      nodes: [
        {
          spanId: "span-1",
          parentSpanId: "parent-1",
          name: "tool call",
          type: "tool",
          startTimeMs: 1_000,
          endTimeMs: 1_025,
          durationMs: 25,
          status: "error",
          model: "gpt-5",
          toolName: "search",
          cost: 0.0125,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 10,
          updatedAtMs: 2_000,
        },
      ],
      nextCursor: null,
    });
  });

  describe("when the repository reports more spans past the page", () => {
    it("keys the next cursor off the page's last row", () => {
      const page = mapSpanSummaryPage({
        rows: [row("a", 1), row("b", 2)],
        hasMore: true,
      });

      expect(page.nodes.map((n) => n.spanId)).toEqual(["a", "b"]);
      expect(page.nextCursor).toEqual({ startTimeMs: 2, spanId: "b" });
    });
  });

  describe("when the repository reports the trace exhausted", () => {
    it("returns a null cursor even for a page that filled to the requested limit", () => {
      const page = mapSpanSummaryPage({
        rows: [row("a", 1), row("b", 2)],
        hasMore: false,
      });

      expect(page.nextCursor).toBeNull();
    });

    it("returns a null cursor for an empty terminal page", () => {
      const page = mapSpanSummaryPage({ rows: [], hasMore: false });

      expect(page.nodes).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe("when a repository breaks the hasMore-implies-rows invariant", () => {
    it("fails loudly instead of silently truncating the walk with a null cursor", () => {
      expect(() => mapSpanSummaryPage({ rows: [], hasMore: true })).toThrow(
        /hasMore without any rows/,
      );
    });
  });
});
