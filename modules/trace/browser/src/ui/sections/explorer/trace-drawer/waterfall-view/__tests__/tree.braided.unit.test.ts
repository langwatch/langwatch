import type { BraidedOwner, SpanTreeNode } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { braidStrandFor, spanNodeKey } from "../../../../../../model/braids/braided-span.ts";
import { buildTree, flattenTree } from "../tree.ts";

function makeSpan({
  spanId,
  parentSpanId,
  ownerProjectId,
  startTimeMs = 0,
}: {
  spanId: string;
  parentSpanId: string | null;
  ownerProjectId?: string;
  startTimeMs?: number;
}): SpanTreeNode {
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
    ...(ownerProjectId ? { ownerProjectId } : {}),
  };
}

const owners: BraidedOwner[] = [
  { projectId: "specialists", name: "Specialists", canOpen: false },
  { projectId: "search", name: "Search", canOpen: true },
];

describe("buildTree with braided spans", () => {
  describe("given a braided span whose parent was not braided", () => {
    /** @scenario "A braided span whose parent was not braided is shown at the top of the trace" */
    it("shows the span at the top of the trace, as a span with a missing parent is", () => {
      const tree = buildTree([
        makeSpan({ spanId: "root", parentSpanId: null }),
        makeSpan({ spanId: "agent", parentSpanId: "unbraided", ownerProjectId: "specialists" }),
      ]);

      expect(tree.map((node) => node.span.spanId)).toEqual(["root", "agent"]);
      expect(tree[1]).toMatchObject({ depth: 0, isOrphaned: true, children: [] });
    });
  });

  describe("given a braided span whose parent is the reader's own span", () => {
    /** @scenario "A braided span whose parent the reader can see hangs under it" */
    it("hangs the span under that span", () => {
      const tree = buildTree([
        makeSpan({ spanId: "root", parentSpanId: null }),
        makeSpan({ spanId: "agent", parentSpanId: "root", ownerProjectId: "specialists" }),
      ]);

      expect(tree).toHaveLength(1);
      expect(tree[0]!.children.map((node) => node.span.spanId)).toEqual(["agent"]);
      expect(tree[0]!.children[0]!.isOrphaned).toBe(false);
    });
  });

  describe("given a braided span whose parent its owner also braided", () => {
    it("hangs it under its owner's span before the reader's span of the same id", () => {
      const tree = buildTree([
        makeSpan({ spanId: "shared", parentSpanId: null }),
        makeSpan({ spanId: "shared", parentSpanId: null, ownerProjectId: "specialists" }),
        makeSpan({ spanId: "child", parentSpanId: "shared", ownerProjectId: "specialists" }),
      ]);

      const braidedParent = tree.find((node) => node.span.ownerProjectId === "specialists");
      const ownParent = tree.find((node) => !node.span.ownerProjectId);
      expect(braidedParent!.children.map((node) => node.span.spanId)).toEqual(["child"]);
      expect(ownParent!.children).toEqual([]);
    });
  });

  describe("given two projects holding the same span id", () => {
    /** @scenario "Two projects holding the same span id show both spans" */
    it("shows both spans, each under its own key", () => {
      const spans = [
        makeSpan({ spanId: "same", parentSpanId: null }),
        makeSpan({ spanId: "same", parentSpanId: null, ownerProjectId: "specialists" }),
      ];
      const rows = flattenTree(buildTree(spans), new Set(), new Set());

      expect(rows).toHaveLength(2);
      const keys = rows.map((row) => (row.kind === "span" ? spanNodeKey(row.node.span) : ""));
      expect(new Set(keys).size).toBe(2);
    });
  });

  describe("given only the reader's own spans", () => {
    it("keys each span by its span id, as before", () => {
      expect(spanNodeKey(makeSpan({ spanId: "own", parentSpanId: null }))).toBe("own");
    });
  });
});

describe("braidStrandFor", () => {
  describe("given the reader's own span", () => {
    it("draws no strand", () => {
      expect(braidStrandFor({ ownerProjectId: undefined, owners })).toBeNull();
    });
  });

  describe("given a braided span", () => {
    it("takes the owner's name from the trace header", () => {
      const strand = braidStrandFor({ ownerProjectId: "search", owners: [owners[1]!] });
      expect(strand).toEqual({ ownerProjectId: "search", ownerName: "Search" });
    });
  });
});
