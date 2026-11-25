import { describe, expect, it } from "vitest";

import { CHUNK_MAX_BYTES } from "../dataset-chunking.rules.ts";
import {
  assertPageWithinLimit,
  assertStoredRowWithinLimit,
  suggestedPageLimit,
} from "../dataset-row-limits.rules.ts";

const record = (id: string, bytes: number) => ({
  id,
  datasetId: "dataset-1",
  projectId: "project-1",
  entry: { text: "x".repeat(bytes) },
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const refusalOf = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }

  return undefined;
};

describe("dataset row limits", () => {
  describe("when a row is larger than one chunk holds", () => {
    /** @scenario "A row too large to store after its pictures are stored is refused" */
    it("refuses it as too large to store", () => {
      const refusal = refusalOf(() =>
        assertStoredRowWithinLimit({ text: "x".repeat(CHUNK_MAX_BYTES) }),
      );

      expect(refusal).toMatchObject({
        code: "dataset_row_too_large",
        httpStatus: 413,
        meta: { maxBytes: CHUNK_MAX_BYTES, measure: "stored" },
      });
    });

    it("accepts a row that fits", () => {
      expect(() => assertStoredRowWithinLimit({ text: "x".repeat(1024) })).not.toThrow();
    });
  });

  describe("when a page of records is larger than one response carries", () => {
    it("names a page size that divides the one asked for", () => {
      const records = Array.from({ length: 50 }, (_, index) => record(`r${index}`, 1000));

      const refusal = refusalOf(() =>
        assertPageWithinLimit({ records, page: 3, limit: 50, maxBytes: 12_000 }),
      );

      expect(refusal).toMatchObject({
        code: "dataset_page_too_large",
        meta: { page: 3, limit: 50, suggestedLimit: 10, suggestedPage: 11 },
      });
    });

    it("sizes the suggestion on the rows the page held, not the rows asked for", () => {
      const records = Array.from({ length: 4 }, (_, index) => record(`r${index}`, 1000));

      const refusal = refusalOf(() =>
        assertPageWithinLimit({ records, page: 1, limit: 100, maxBytes: 2500 }),
      );

      expect(refusal).toMatchObject({ meta: { suggestedLimit: 2 } });
    });

    it("falls to one row when nothing larger fits", () => {
      expect(suggestedPageLimit(7, 3)).toBe(1);
      expect(suggestedPageLimit(50, 0)).toBe(1);
    });
  });

  describe("when a page holds one record", () => {
    it("serves it whatever its size", () => {
      expect(() =>
        assertPageWithinLimit({ records: [record("r1", 5000)], page: 1, limit: 1, maxBytes: 10 }),
      ).not.toThrow();
    });
  });

  describe("when a page fits", () => {
    it("serves it", () => {
      const records = [record("r1", 100), record("r2", 100)];

      expect(() =>
        assertPageWithinLimit({ records, page: 1, limit: 50, maxBytes: 10_000 }),
      ).not.toThrow();
    });
  });
});
