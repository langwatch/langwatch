import { describe, expect, it } from "vitest";

import { buildTree, computeSpanContext, formatPercent, generateTicks } from "../tree";
import type { TraceFlameSpan, Viewport } from "../types";

const span = (
  spanId: string,
  startTimeMs: number,
  endTimeMs: number,
  parentSpanId: string | null = null,
): TraceFlameSpan => ({
  spanId,
  parentSpanId,
  name: spanId,
  type: "span",
  startTimeMs,
  endTimeMs,
  status: "ok",
  model: null,
});

describe("trace flame tree", () => {
  it("sorts children by start time while retaining orphan spans as roots", () => {
    const tree = buildTree([
      span("late", 40, 60, "root"),
      span("orphan", 5, 8, "missing-parent"),
      span("root", 0, 100),
      span("early", 10, 20, "root"),
    ]);

    expect(tree.roots.map((node) => node.span.spanId)).toEqual(["root", "orphan"]);
    expect(tree.roots[0]?.children.map((node) => node.span.spanId)).toEqual(["early", "late"]);
    expect(tree.byId.get("orphan")?.isOrphaned).toBe(true);
    expect(tree.maxDepth).toBe(1);
  });

  it("computes parent and trace context using the visible full range", () => {
    const tree = buildTree([span("root", 0, 100), span("child", 20, 60, "root")]);
    const child = tree.byId.get("child");
    const fullRange: Viewport = { startMs: 0, endMs: 200 };

    if (!child) throw new Error("child span was not built");

    expect(computeSpanContext(child, fullRange)).toEqual({
      duration: 40,
      parentName: "root",
      parentDuration: 100,
      pctOfParent: 40,
      pctOfTrace: 20,
    });
  });

  it("keeps tick labels stable across zoom ranges", () => {
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(4.25)).toBe("4.3%");
    expect(generateTicks({ startMs: 0, endMs: 1000 }, 0, 2)).toEqual([
      { time: 0, label: "0ms" },
      { time: 500, label: "500ms" },
      { time: 1000, label: "1.0s" },
    ]);
  });
});
