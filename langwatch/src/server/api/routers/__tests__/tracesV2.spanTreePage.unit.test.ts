import { describe, expect, it } from "vitest";
import type { SpanSummaryRow } from "~/server/app-layer/traces/repositories/span-storage.repository";
import { mapSpanSummaryPage } from "../tracesV2";

const row = (spanId: string, startTimeMs: number): SpanSummaryRow => ({
  spanId,
  parentSpanId: null,
  spanName: spanId,
  durationMs: 1,
  statusCode: null,
  spanType: null,
  model: null,
  cost: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  startTimeMs,
});

describe("mapSpanSummaryPage", () => {
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
