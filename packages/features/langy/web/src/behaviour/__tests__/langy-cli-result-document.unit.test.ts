import { describe, expect, it } from "vitest";
import {
  collectionOf,
  countResults,
  totalOf,
} from "../langy-cli-result-document";

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

describe("totalOf and collectionOf over a reduced list", () => {
  describe("given a list the reduction cut down", () => {
    const reduced = [
      { id: "prompt_1" },
      { id: "prompt_2" },
      "… 29 more items truncated",
    ];

    describe("when the list states no total of its own", () => {
      /** @scenario A list too large for the chat counts the rows the reduction removed */
      it("counts the rows it kept plus the rows the marker stands for", () => {
        expect(totalOf(reduced)).toBe(31);
        expect(countResults(JSON.stringify(reduced))).toBe(31);
      });

      /** @scenario A list too large for the chat counts the rows the reduction removed */
      it("keeps the marker out of the rows a card draws", () => {
        expect(collectionOf(reduced)).toEqual([
          { id: "prompt_1" },
          { id: "prompt_2" },
        ]);
      });

      it("reads the newer marker form that states the total", () => {
        const stated = [
          { id: "prompt_1" },
          { id: "prompt_2" },
          "… 42 more items truncated, 44 total",
        ];
        expect(totalOf(stated)).toBe(44);
        expect(collectionOf(stated)).toEqual([
          { id: "prompt_1" },
          { id: "prompt_2" },
        ]);
      });

      it("reads the marker inside a resource-named envelope too", () => {
        const document = { prompts: reduced };
        expect(totalOf(document)).toBe(31);
        expect(collectionOf(document)).toHaveLength(2);
      });
    });

    describe("when the list states its own total", () => {
      it("keeps the stated total, which is the one that was queried", () => {
        const document = { traces: reduced, pagination: { totalHits: 900 } };
        expect(totalOf(document)).toBe(900);
        expect(collectionOf(document)).toHaveLength(2);
      });
    });

    describe("when nothing was removed", () => {
      it("counts the rows, and a string row is still a row", () => {
        expect(totalOf(["alpha", "beta"])).toBe(2);
        expect(collectionOf(["alpha", "beta"])).toEqual(["alpha", "beta"]);
      });

      it("stays null for a document that holds no collection", () => {
        expect(totalOf({ id: "x", name: "y" })).toBeNull();
      });
    });
  });
});
