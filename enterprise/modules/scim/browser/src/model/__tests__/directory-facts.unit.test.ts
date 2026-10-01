import { describe, expect, it } from "vitest";

import { directoryFactsOf } from "../directory-facts.ts";
import { relativeTime } from "../display-formatters.ts";

const connection = (connectionState: string, lastPushedAtMs: number | null, managedPeople = 1) => ({
  connectionState,
  lastPushedAtMs,
  managedPeople,
});

describe("directoryFactsOf", () => {
  describe("given a removed connection beside a running one", () => {
    it("counts only the running one, and its last push is the organization's", () => {
      const facts = directoryFactsOf({
        connections: [connection("ACTIVE", 100, 3), connection("TORN_DOWN", 900, 7)],
        groups: [],
        provenance: {},
      });

      expect(facts.connections).toHaveLength(1);
      expect(facts.lastPushedAtMs).toBe(100);
      expect(facts.managedPeople).toBe(3);
    });
  });

  describe("given members who arrived different ways", () => {
    it("counts who the directory created apart from everybody else", () => {
      const facts = directoryFactsOf({
        connections: [],
        groups: [
          { id: "a", scimSource: "okta" },
          { id: "b", scimSource: null },
        ],
        provenance: { ana: { source: "directory" }, ivy: { source: "invited" } },
      });

      expect(facts.insideDirectory).toBe(1);
      expect(facts.outsideDirectory).toBe(1);
      expect(facts.directoryGroups.map((group) => group.id)).toEqual(["a"]);
    });
  });
});

describe("relativeTime", () => {
  it("says never for no moment, and coarsens as the gap widens", () => {
    const nowMs = 10 * 24 * 60 * 60 * 1000;
    expect(relativeTime({ atMs: null, nowMs })).toBe("Never");
    expect(relativeTime({ atMs: nowMs - 5 * 60 * 1000, nowMs })).toBe("5 min ago");
    expect(relativeTime({ atMs: nowMs - 3 * 24 * 60 * 60 * 1000, nowMs })).toBe("3d ago");
  });
});
