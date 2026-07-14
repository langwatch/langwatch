import { describe, expect, it } from "vitest";
import type { TraceListItem } from "../../../../../../types/trace";
import {
  ioPreviewContentBoundary,
  ioPreviewWillRenderFor,
  __splitColumnsAroundForTest as splitColumnsAround,
} from "../IOPreviewAddon";

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

describe("ioPreviewContentBoundary", () => {
  it("returns the full width when no reserved column is visible", () => {
    expect(
      ioPreviewContentBoundary({
        visibleColumnIds: ["time", "trace", "input", "model"],
        colCount: 4,
      }),
    ).toBe(4);
  });

  it("stops at the leftmost reserved column (labels / evals / prompt / events)", () => {
    expect(
      ioPreviewContentBoundary({
        visibleColumnIds: [
          "time",
          "trace",
          "model",
          "labels",
          "evaluations",
          "events",
        ],
        colCount: 6,
      }),
    ).toBe(3);
  });

  it("follows the live order — evals before labels stops at evals", () => {
    expect(
      ioPreviewContentBoundary({
        visibleColumnIds: ["time", "evaluations", "labels"],
        colCount: 3,
      }),
    ).toBe(1);
  });
});

describe("splitColumnsAround", () => {
  describe("given no reserved boundary (preview spans the full width)", () => {
    describe("when the columns are split", () => {
      it("returns a single content segment over every column", () => {
        expect(
          splitColumnsAround({
            colCount: 9,
            contentBoundary: 9,
            claimedIndices: [],
          }),
        ).toEqual([{ span: 9, role: "content" }]);
      });
    });
  });

  describe("given the boundary at the rowspan-claimed (evals) column", () => {
    describe("when the claim is the last column", () => {
      it("content stops before it and the claimed column is dropped", () => {
        expect(
          splitColumnsAround({
            colCount: 9,
            contentBoundary: 8,
            claimedIndices: [8],
          }),
        ).toEqual([{ span: 8, role: "content" }]);
      });
    });

    describe("when columns follow the claim", () => {
      it("emits trailing filler for columns after the claim", () => {
        expect(
          splitColumnsAround({
            colCount: 9,
            contentBoundary: 7,
            claimedIndices: [7],
          }),
        ).toEqual([
          { span: 7, role: "content" },
          { span: 1, role: "filler" },
        ]);
      });
    });
  });

  describe("given the boundary LEFT of the rowspan claim (labels before evals)", () => {
    describe("when the columns are split", () => {
      it("content stops at the boundary, the gap is filler, evals is dropped", () => {
        // boundary=3 (labels), evals claimed at 5, 8 columns total.
        expect(
          splitColumnsAround({
            colCount: 8,
            contentBoundary: 3,
            claimedIndices: [5],
          }),
        ).toEqual([
          { span: 3, role: "content" }, // [0,3) preview, bounded + scrolls
          { span: 2, role: "filler" }, // [3,5) labels + gap, scrolls
          { span: 2, role: "filler" }, // [6,8) after the dropped evals cell
        ]);
      });
    });
  });

  describe("given a boundary at column 0 (a reserved column leads the row)", () => {
    describe("when the columns are split", () => {
      it("renders filler only, so the preview can't paint over the leading reserved column", () => {
        expect(
          splitColumnsAround({
            colCount: 5,
            contentBoundary: 0,
            claimedIndices: [0],
          }),
        ).toEqual([{ span: 4, role: "filler" }]);
      });
    });
  });
});
