import { describe, expect, it } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { rankedErrorSpans } from "../errorSpans";

function span(partial: Partial<SpanTreeNode>): SpanTreeNode {
  return {
    spanId: "s",
    parentSpanId: null,
    name: "span",
    type: null,
    startTimeMs: 0,
    endTimeMs: 1,
    durationMs: 1,
    status: "ok",
    model: null,
    ...partial,
  };
}

describe("rankedErrorSpans", () => {
  describe("given a flat list of spans with no errors", () => {
    describe("when ranking is requested", () => {
      it("returns an empty array", () => {
        const spans = [
          span({ spanId: "a", status: "ok" }),
          span({ spanId: "b", status: "ok" }),
        ];
        expect(rankedErrorSpans(spans)).toEqual([]);
      });
    });
  });

  describe("given mixed error / ok spans across a tree", () => {
    describe("when ranking is requested", () => {
      it("ranks deepest-first, then by startTimeMs as a tiebreaker", () => {
        // Tree:
        //   root (ok)
        //     ├── m1 (error, depth=1, start=20)
        //     │     └── leaf-late (error, depth=2, start=40)
        //     └── m2 (error, depth=1, start=10)
        const spans = [
          span({ spanId: "root", status: "ok", parentSpanId: null }),
          span({
            spanId: "m1",
            status: "error",
            parentSpanId: "root",
            startTimeMs: 20,
            name: "m1",
          }),
          span({
            spanId: "leaf-late",
            status: "error",
            parentSpanId: "m1",
            startTimeMs: 40,
            name: "leaf-late",
          }),
          span({
            spanId: "m2",
            status: "error",
            parentSpanId: "root",
            startTimeMs: 10,
            name: "m2",
          }),
        ];

        const out = rankedErrorSpans(spans).map((r) => ({
          id: r.span.spanId,
          depth: r.depth,
        }));

        expect(out).toEqual([
          // Deepest-first.
          { id: "leaf-late", depth: 2 },
          // Equal depth, earlier start wins.
          { id: "m2", depth: 1 },
          { id: "m1", depth: 1 },
        ]);
      });
    });
  });

  describe("given a span whose parent isn't in the trace", () => {
    describe("when ranking is requested", () => {
      it("treats the missing parent as depth 0 and keeps the span in the list", () => {
        const spans = [
          span({
            spanId: "orphan",
            status: "error",
            parentSpanId: "phantom-id-not-in-trace",
            name: "orphan",
          }),
        ];
        expect(rankedErrorSpans(spans)).toEqual([
          { span: spans[0], depth: 0 },
        ]);
      });
    });
  });

  describe("given an empty span list", () => {
    describe("when ranking is requested", () => {
      it("returns an empty array without throwing", () => {
        expect(rankedErrorSpans([])).toEqual([]);
      });
    });
  });

  describe("given spans with cyclic parent links", () => {
    describe("when ranking is requested", () => {
      it("bails out of the depth walk instead of looping forever", () => {
        // a → b → a (cycle). Both are error spans so they enter ranking.
        const spans = [
          span({
            spanId: "a",
            status: "error",
            parentSpanId: "b",
            name: "a",
          }),
          span({
            spanId: "b",
            status: "error",
            parentSpanId: "a",
            name: "b",
          }),
        ];
        const out = rankedErrorSpans(spans).map((r) => r.span.spanId);
        // Order isn't load-bearing here, only that the call returns.
        expect(out.sort()).toEqual(["a", "b"]);
      });
    });
  });
});
