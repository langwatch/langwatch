import { describe, expect, it } from "vitest";
import { dedupeByValue } from "../dedupeByValue";

// Backs the SUPPLEMENT (not replace) merge of preloaded facet items with
// server prefix-search results: the same value can appear in both lists, and
// the preloaded entry — which carries the richer payload — must win.

describe("dedupeByValue", () => {
  describe("given two lists that share a value", () => {
    it("keeps the first occurrence so the preloaded entry's payload survives", () => {
      const preloaded = [
        { value: "gpt-4o", count: 50, dotColor: "blue" },
        { value: "claude", count: 40, dotColor: "purple" },
      ];
      const server = [
        { value: "gpt-4o", count: 1 },
        { value: "gpt-4o-mini", count: 2 },
      ];

      expect(dedupeByValue([...preloaded, ...server])).toEqual([
        { value: "gpt-4o", count: 50, dotColor: "blue" },
        { value: "claude", count: 40, dotColor: "purple" },
        { value: "gpt-4o-mini", count: 2 },
      ]);
    });
  });

  describe("given no duplicates", () => {
    it("returns the items unchanged and in order", () => {
      const items = [{ value: "a" }, { value: "b" }, { value: "c" }];
      expect(dedupeByValue(items)).toEqual(items);
    });
  });
});
