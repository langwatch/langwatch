import { describe, expect, it } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import {
  buildTree,
  countDescendants,
  flattenTree,
  shouldShowTimeline,
  siblingGroupKey,
} from "../tree";
import {
  COLLAPSE_TIMELINE_BELOW_PX,
  isTwoLineSpan,
  SIBLING_GROUP_THRESHOLD,
  type SiblingGroup,
} from "../types";

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

describe("shouldShowTimeline", () => {
  describe("given a drawer narrower than the breakpoint", () => {
    it("hides the timeline panel", () => {
      expect(shouldShowTimeline(COLLAPSE_TIMELINE_BELOW_PX - 1)).toBe(false);
      expect(shouldShowTimeline(300)).toBe(false);
    });
  });

  describe("given a drawer at or above the breakpoint", () => {
    it("shows the timeline panel", () => {
      expect(shouldShowTimeline(COLLAPSE_TIMELINE_BELOW_PX)).toBe(true);
      expect(shouldShowTimeline(1200)).toBe(true);
    });
  });

  describe("given the container hasn't been measured yet (width 0)", () => {
    it("defaults to showing the timeline, so a wide drawer doesn't flash collapsed on mount", () => {
      expect(shouldShowTimeline(0)).toBe(true);
    });
  });
});

describe("siblingGroupKey", () => {
  const base = {
    parentSpanId: "root",
    name: "claude_code.tool",
    type: "tool",
    toolName: "Bash" as string | null,
  };

  describe("given two groups differing only by tool name", () => {
    it("produces distinct keys", () => {
      expect(siblingGroupKey(base)).not.toBe(
        siblingGroupKey({ ...base, toolName: "WebSearch" }),
      );
    });
  });

  describe("given two groups differing only by span type", () => {
    it("produces distinct keys", () => {
      expect(siblingGroupKey(base)).not.toBe(
        siblingGroupKey({ ...base, type: "span" }),
      );
    });
  });
});

describe("flattenTree", () => {
  function toolSpan(spanId: string, toolName: string, i: number): SpanTreeNode {
    return {
      ...makeSpan(spanId, "root", i),
      name: "claude_code.tool",
      type: "tool",
      toolName,
    };
  }

  describe("given a turn with two big per-tool sibling groups", () => {
    const spans: SpanTreeNode[] = [
      makeSpan("root", null),
      ...Array.from({ length: SIBLING_GROUP_THRESHOLD + 1 }, (_, i) =>
        toolSpan(`bash-${i}`, "Bash", i + 1),
      ),
      ...Array.from({ length: SIBLING_GROUP_THRESHOLD + 1 }, (_, i) =>
        toolSpan(`search-${i}`, "WebSearch", i + 20),
      ),
    ];

    describe("when one group's canonical key is expanded", () => {
      it("expands only that group, not its same-named sibling group", () => {
        const tree = buildTree(spans);
        const collapsed = flattenTree(tree, new Set(), new Set());
        const groups = collapsed.filter(
          (r): r is SiblingGroup => "kind" in r && r.kind === "group",
        );
        expect(groups.map((g) => g.toolName)).toEqual(["Bash", "WebSearch"]);

        const expanded = flattenTree(
          tree,
          new Set(),
          new Set([siblingGroupKey(groups[0]!)]),
        );
        const spanRows = expanded.filter((r) => !("count" in r));
        const expandedIds = spanRows.map((r) =>
          "node" in r ? r.node.span.spanId : "",
        );
        expect(expandedIds).toContain("bash-0");
        expect(expandedIds).not.toContain("search-0");
      });
    });
  });
});

describe("isTwoLineSpan", () => {
  describe("given an llm span with a model", () => {
    it("renders two lines", () => {
      expect(
        isTwoLineSpan({
          type: "llm",
          model: "claude-sonnet-5",
          toolName: null,
        }),
      ).toBe(true);
    });
  });

  describe("given a named tool span", () => {
    it("renders two lines, matching TreeRow's taller row", () => {
      expect(
        isTwoLineSpan({ type: "tool", model: null, toolName: "Bash" }),
      ).toBe(true);
    });
  });

  describe("given an ordinary span", () => {
    it("stays single-line", () => {
      expect(isTwoLineSpan({ type: "span", model: null, toolName: null })).toBe(
        false,
      );
    });
  });
});
