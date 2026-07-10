import { describe, expect, it } from "vitest";
import type { TraceListItem } from "~/server/app-layer/traces/trace-list.service";
import { formatTraceReportRow } from "../trace-report-row";

function makeItem(overrides: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "trace-1",
    input: null,
    ...overrides,
  } as TraceListItem;
}

describe("formatTraceReportRow", () => {
  describe("given a trace with an input preview", () => {
    it("renders `<traceId> — <snippet>` with whitespace collapsed", () => {
      const row = formatTraceReportRow(
        makeItem({ traceId: "trace-abc", input: "hello\n   world  " }),
      );
      expect(row).toBe("trace-abc — hello world");
    });
  });

  describe("given an input longer than the cap", () => {
    it("truncates the snippet with an ellipsis", () => {
      const row = formatTraceReportRow(
        makeItem({ traceId: "trace-abc", input: "x".repeat(500) }),
      );
      expect(row.startsWith("trace-abc — ")).toBe(true);
      expect(row.endsWith("…")).toBe(true);
      // traceId + " — " (12) + 119 snippet chars + "…" = well under 500.
      expect(row.length).toBeLessThan(150);
    });
  });

  describe("given a trace with no input preview", () => {
    it("falls back to the bare trace id", () => {
      expect(formatTraceReportRow(makeItem({ traceId: "trace-xyz" }))).toBe(
        "trace-xyz",
      );
      expect(
        formatTraceReportRow(makeItem({ traceId: "trace-xyz", input: "   " })),
      ).toBe("trace-xyz");
    });
  });
});
