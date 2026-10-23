import { describe, expect, it } from "vitest";

import { braidBadgeIsCompact, selectedSpanOwnerIn } from "../braided-span.ts";

const own = { spanId: "span-1", ownerProjectId: null };
const braided = { spanId: "span-2", ownerProjectId: "project_specialists" };

describe("selectedSpanOwnerIn", () => {
  /** @scenario "Selecting a braided span reads it from its owner" */
  it("reads a braided span from its owner", () => {
    expect(selectedSpanOwnerIn({ nodes: [own, braided], spanId: "span-2" })).toBe(
      "project_specialists",
    );
  });

  it("reads the reader's own span from the reader", () => {
    expect(selectedSpanOwnerIn({ nodes: [own, braided], spanId: "span-1" })).toBeUndefined();
  });

  /** @scenario "Selecting a braided span reads it from its owner" */
  it("prefers the reader's own span when an owner holds the same span id", () => {
    const sameId = { spanId: "span-1", ownerProjectId: "project_specialists" };
    expect(selectedSpanOwnerIn({ nodes: [sameId, own], spanId: "span-1" })).toBeUndefined();
  });

  it("names no owner before the tree has loaded or with nothing selected", () => {
    expect(selectedSpanOwnerIn({ nodes: undefined, spanId: "span-2" })).toBeUndefined();
    expect(selectedSpanOwnerIn({ nodes: [braided], spanId: null })).toBeUndefined();
  });
});

describe("braidBadgeIsCompact", () => {
  const names = { spanName: "payments_agent", ownerName: "Specialists" };

  it("keeps the whole badge where both names fit", () => {
    expect(braidBadgeIsCompact({ treeWidthPx: 600, depth: 1, ...names })).toBe(false);
  });

  it("shrinks the badge to its mark where the span's name needs the room", () => {
    expect(braidBadgeIsCompact({ treeWidthPx: 260, depth: 1, ...names })).toBe(true);
  });

  it("shrinks it on a deeper row of the same width first", () => {
    expect(braidBadgeIsCompact({ treeWidthPx: 330, depth: 0, ...names })).toBe(false);
    expect(braidBadgeIsCompact({ treeWidthPx: 330, depth: 3, ...names })).toBe(true);
  });
});
