import { featureProjectColour } from "@langwatch/design-system/feature-project-colour";
import { describe, expect, it } from "vitest";

import {
  braidBadgeIsCompact,
  braidColourIndexes,
  braidStrandFor,
  selectedSpanOwnerIn,
} from "../braided-span.ts";

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

describe("braidColourIndexes", () => {
  const colourOf = (projectId: string) =>
    featureProjectColour({ feature: "braids", projectId }).index;

  describe("given owners whose project colours differ", () => {
    it("gives each owner the colour the Braids page gives its project", () => {
      const owners = [{ projectId: "proj_specialists" }, { projectId: "proj_payments" }];
      expect(braidColourIndexes(owners)).toEqual(
        new Map([
          ["proj_specialists", colourOf("proj_specialists")],
          ["proj_payments", colourOf("proj_payments")],
        ]),
      );
    });
  });

  describe("given two owners in one trace landing on the same colour", () => {
    it("gives the later owner in header order the next free colour", () => {
      expect(colourOf("proj_search")).toBe(colourOf("proj_specialists"));
      const indexes = braidColourIndexes([
        { projectId: "proj_specialists" },
        { projectId: "proj_search" },
        { projectId: "proj_billing" },
      ]);

      expect(indexes.get("proj_specialists")).toBe(colourOf("proj_specialists"));
      expect(new Set(indexes.values()).size).toBe(3);
    });

    it("colours the later owner's badge and bar alike", () => {
      const owners = [
        { projectId: "proj_specialists", name: "Specialists", canOpen: false },
        { projectId: "proj_search", name: "Search", canOpen: false },
      ];
      const later = braidStrandFor({ ownerProjectId: "proj_search", owners });
      const earlier = braidStrandFor({ ownerProjectId: "proj_specialists", owners });

      expect(later?.colour).not.toBe(earlier?.colour);
    });
  });

  describe("given more owners than colours", () => {
    it("lets the fourth owner keep its own project colour", () => {
      const indexes = braidColourIndexes([
        { projectId: "proj_specialists" },
        { projectId: "proj_search" },
        { projectId: "proj_billing" },
        { projectId: "proj_ledger" },
      ]);
      expect(indexes.get("proj_ledger")).toBe(colourOf("proj_ledger"));
    });
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
