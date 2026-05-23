import { describe, expect, it } from "vitest";
import {
  __splitColumnsAroundForTest as splitColumnsAround,
  ioPreviewWillRenderFor,
} from "../IOPreviewAddon";
import type { TraceListItem } from "../../../../../../types/trace";

function row(
  partial: Partial<TraceListItem> & {
    input: TraceListItem["input"];
    output: TraceListItem["output"];
  },
): TraceListItem {
  return {
    traceId: "t",
    timestamp: 0,
    name: "n",
    durationMs: 0,
    totalCost: 0,
    totalTokens: 0,
    spanCount: 0,
    models: [],
    evaluations: [],
    events: [],
    status: "ok",
    serviceName: null,
    origin: null,
    ttft: null,
    userId: null,
    conversationId: null,
    inputTokens: null,
    outputTokens: null,
    rootSpanType: null,
    traceName: null,
    error: null,
    errorSpanName: null,
    ...partial,
  } as TraceListItem;
}

describe("ioPreviewWillRenderFor", () => {
  describe("given a row with input and output", () => {
    it("renders when not expanded", () => {
      expect(
        ioPreviewWillRenderFor(row({ input: "hi", output: "hello" }), false),
      ).toBe(true);
    });

    it("suppresses when expanded so the expanded peek owns the area", () => {
      expect(
        ioPreviewWillRenderFor(row({ input: "hi", output: "hello" }), true),
      ).toBe(false);
    });
  });

  describe("given a row missing either side", () => {
    it("skips when only input is present", () => {
      expect(
        ioPreviewWillRenderFor(row({ input: "hi", output: null }), false),
      ).toBe(false);
    });

    it("skips when only output is present", () => {
      expect(
        ioPreviewWillRenderFor(row({ input: null, output: "hello" }), false),
      ).toBe(false);
    });

    it("skips when both are null", () => {
      expect(
        ioPreviewWillRenderFor(row({ input: null, output: null }), false),
      ).toBe(false);
    });
  });
});

describe("splitColumnsAround", () => {
  describe("given no rowSpan claims", () => {
    it("returns a single content segment spanning every column", () => {
      expect(splitColumnsAround(9, [])).toEqual([
        { span: 9, role: "content" },
      ]);
    });
  });

  describe("given a single claim at the end of the row", () => {
    it("emits one content segment covering the columns to the left", () => {
      expect(splitColumnsAround(9, [8])).toEqual([
        { span: 8, role: "content" },
      ]);
    });
  });

  describe("given a single claim in the middle of the row", () => {
    it("emits content on the left and filler on the right", () => {
      expect(splitColumnsAround(9, [7])).toEqual([
        { span: 7, role: "content" },
        { span: 1, role: "filler" },
      ]);
    });
  });

  describe("given a claim at column 0", () => {
    it("promotes the first surviving segment to content so the preview still renders", () => {
      expect(splitColumnsAround(5, [0])).toEqual([
        { span: 4, role: "content" },
      ]);
    });
  });

  describe("given two claims with gaps in between", () => {
    it("emits a left content + middle filler + right filler", () => {
      expect(splitColumnsAround(10, [3, 7])).toEqual([
        { span: 3, role: "content" },
        { span: 3, role: "filler" },
        { span: 2, role: "filler" },
      ]);
    });
  });
});
