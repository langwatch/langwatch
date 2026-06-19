import { describe, expect, it } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { buildTree, countDescendants } from "../tree";

function makeSpan(
  spanId: string,
  parentSpanId: string | null,
  startTimeMs = 0,
): SpanTreeNode {
  return {
    spanId,
    parentSpanId,
    name: spanId,
    type: "span",
    startTimeMs,
    endTimeMs: startTimeMs + 10,
    durationMs: 10,
    status: "ok",
    model: null,
    cost: null,
  };
}

describe("countDescendants", () => {
  describe("given a leaf node", () => {
    it("returns 0", () => {
      const [root] = buildTree([makeSpan("root", null)]);
      expect(countDescendants(root!)).toBe(0);
    });
  });

  describe("given a node with direct children only", () => {
    it("counts each child once", () => {
      const [root] = buildTree([
        makeSpan("root", null),
        makeSpan("a", "root", 1),
        makeSpan("b", "root", 2),
      ]);
      expect(countDescendants(root!)).toBe(2);
    });
  });

  describe("given a node with nested descendants", () => {
    it("counts children, grandchildren, and deeper levels", () => {
      const [root] = buildTree([
        makeSpan("root", null),
        makeSpan("a", "root", 1),
        makeSpan("a1", "a", 2),
        makeSpan("a1x", "a1", 3),
        makeSpan("b", "root", 4),
        makeSpan("b1", "b", 5),
      ]);
      // a, a1, a1x, b, b1
      expect(countDescendants(root!)).toBe(5);
    });

    it("counts only the subtree of the given node", () => {
      const tree = buildTree([
        makeSpan("root", null),
        makeSpan("a", "root", 1),
        makeSpan("a1", "a", 2),
        makeSpan("b", "root", 3),
      ]);
      const a = tree[0]!.children.find((n) => n.span.spanId === "a")!;
      expect(countDescendants(a)).toBe(1);
    });
  });
});
