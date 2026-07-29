import { describe, expect, it } from "vitest";
import type { TraceListItem } from "~/server/app-layer/traces/trace-list.service";
import { formatReportRowLine } from "~/shared/templating/templateContext";
import { toReportTraceRow } from "../trace-report-row";

const PROJECT_URL = "https://app.langwatch.ai/my-project";

function makeItem(overrides: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "trace-1",
    timestamp: Date.parse("2026-07-11T09:00:00.000Z"),
    input: null,
    output: null,
    models: [],
    status: "ok",
    totalCost: 0,
    durationMs: 0,
    ...overrides,
  } as TraceListItem;
}

describe("toReportTraceRow", () => {
  describe("given a trace with an input preview", () => {
    it("collapses whitespace in the snippet", () => {
      const row = toReportTraceRow({
        item: makeItem({ input: "hello\n   world  " }),
        projectUrl: PROJECT_URL,
      });
      expect(row.input).toBe("hello world");
    });
  });

  describe("given an input longer than the cap", () => {
    it("truncates the snippet with an ellipsis", () => {
      const row = toReportTraceRow({
        item: makeItem({ input: "x".repeat(500) }),
        projectUrl: PROJECT_URL,
      });
      expect(row.input.endsWith("…")).toBe(true);
      expect(row.input.length).toBe(120);
    });
  });

  describe("when the trace carries cost and duration", () => {
    it("keeps them as numbers so a table can render numeric cells", () => {
      const row = toReportTraceRow({
        item: makeItem({ totalCost: 0.0241, durationMs: 1834 }),
        projectUrl: PROJECT_URL,
      });
      expect(row.costUsd).toBe(0.0241);
      expect(row.durationMs).toBe(1834);
    });
  });

  describe("when the trace used models", () => {
    it("joins them into one label", () => {
      const row = toReportTraceRow({
        item: makeItem({ models: ["gpt-5-mini", "claude-opus-4-8"] }),
        projectUrl: PROJECT_URL,
      });
      expect(row.model).toBe("gpt-5-mini, claude-opus-4-8");
    });
  });

  it("deep-links the trace", () => {
    const row = toReportTraceRow({
      item: makeItem({ traceId: "trace-abc" }),
      projectUrl: PROJECT_URL,
    });
    expect(row.url).toBe(`${PROJECT_URL}/messages/trace-abc`);
  });
});

describe("formatReportRowLine", () => {
  describe("given a row with an input snippet", () => {
    it("renders `<traceId> — <snippet>`", () => {
      const row = toReportTraceRow({
        item: makeItem({ traceId: "trace-abc", input: "hello world" }),
        projectUrl: PROJECT_URL,
      });
      expect(formatReportRowLine(row)).toBe("trace-abc — hello world");
    });
  });

  describe("given a row with no input preview", () => {
    it("falls back to the bare trace id", () => {
      const row = toReportTraceRow({
        item: makeItem({ traceId: "trace-xyz", input: "   " }),
        projectUrl: PROJECT_URL,
      });
      expect(formatReportRowLine(row)).toBe("trace-xyz");
    });
  });
});
