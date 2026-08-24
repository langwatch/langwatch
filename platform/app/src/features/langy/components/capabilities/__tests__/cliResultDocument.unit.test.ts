import { describe, expect, it } from "vitest";
import { collectionOf, countResults, totalOf } from "../cliResultDocument";

describe("collectionOf", () => {
  describe("given a recognised collection key", () => {
    it("returns the array under it", () => {
      expect(collectionOf({ items: [1, 2] })).toEqual([1, 2]);
      expect(collectionOf({ traces: [] })).toEqual([]);
    });
  });

  describe("given a resource-named list envelope", () => {
    it("reads the single array key of a paginated envelope", () => {
      const document = {
        experiments: [{ slug: "a" }, { slug: "b" }],
        pagination: { page: 1, pageSize: 50, totalHits: 2, hasMore: false },
      };
      expect(collectionOf(document)).toEqual([{ slug: "a" }, { slug: "b" }]);
    });

    it("reads a document that holds nothing but the one list", () => {
      expect(collectionOf({ versions: [{ version: 1 }] })).toEqual([
        { version: 1 },
      ]);
    });

    it("stays null when two arrays make the list ambiguous", () => {
      expect(
        collectionOf({ targets: [1], evaluations: [2], pagination: {} }),
      ).toBeNull();
    });

    it("stays null for an unpaginated array beside other fields", () => {
      expect(collectionOf({ warnings: ["w"], name: "run" })).toBeNull();
    });
  });

  describe("given no collection at all", () => {
    it("returns null for a single resource", () => {
      expect(collectionOf({ id: "x", name: "y" })).toBeNull();
    });
  });
});

describe("countResults", () => {
  it("counts a paginated resource-named envelope by its total", () => {
    const output = JSON.stringify({
      experiments: [{ slug: "a" }],
      pagination: { page: 1, pageSize: 50, totalHits: 7, hasMore: true },
    });
    expect(countResults(output)).toBe(7);
    expect(
      totalOf({ pagination: { page: 1, pageSize: 50, totalHits: 7 } }),
    ).toBe(7);
  });
});
