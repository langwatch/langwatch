import { describe, expect, it } from "vitest";
import {
  datasetEntryDeepLinkHref,
  pageForRowIndex,
  parseRowQueryParam,
} from "../datasetRowPaging";

describe("parseRowQueryParam", () => {
  describe("given a plain non-negative integer string", () => {
    it("parses it to a number", () => {
      expect(parseRowQueryParam("0")).toBe(0);
      expect(parseRowQueryParam("327")).toBe(327);
    });
  });

  describe("given anything else", () => {
    /** @scenario "A malformed or missing row query value is ignored" */
    it("returns undefined rather than throwing", () => {
      expect(parseRowQueryParam(undefined)).toBeUndefined();
      expect(parseRowQueryParam("")).toBeUndefined();
      expect(parseRowQueryParam("-1")).toBeUndefined();
      expect(parseRowQueryParam("1.5")).toBeUndefined();
      expect(parseRowQueryParam("abc")).toBeUndefined();
      expect(parseRowQueryParam(["0", "1"])).toBeUndefined();
    });
  });
});

describe("datasetEntryDeepLinkHref", () => {
  it("builds a project-scoped dataset link with the row as a query param", () => {
    expect(
      datasetEntryDeepLinkHref({
        projectSlug: "my-project",
        datasetId: "dataset_abc123",
        index: 42,
      }),
    ).toBe("/my-project/datasets/dataset_abc123?row=42");
  });

  it("points at row 0 for the first entry, not an empty query value", () => {
    expect(
      datasetEntryDeepLinkHref({
        projectSlug: "my-project",
        datasetId: "dataset_abc123",
        index: 0,
      }),
    ).toBe("/my-project/datasets/dataset_abc123?row=0");
  });
});

describe("pageForRowIndex", () => {
  describe("given an index on the first page", () => {
    it("resolves to page 1 at its own position", () => {
      expect(pageForRowIndex({ index: 0, pageSize: 50 })).toEqual({
        page: 1,
        indexOnPage: 0,
      });
      expect(pageForRowIndex({ index: 49, pageSize: 50 })).toEqual({
        page: 1,
        indexOnPage: 49,
      });
    });
  });

  describe("given an index exactly at a page boundary", () => {
    it("resolves to the start of the next page", () => {
      expect(pageForRowIndex({ index: 50, pageSize: 50 })).toEqual({
        page: 2,
        indexOnPage: 0,
      });
    });
  });

  describe("given an index deep into a later page", () => {
    /** @scenario "A row index resolves to its page and position on that page" */
    it("resolves to that page at the right offset", () => {
      expect(pageForRowIndex({ index: 127, pageSize: 50 })).toEqual({
        page: 3,
        indexOnPage: 27,
      });
    });
  });

  describe("given a page size of 1", () => {
    it("puts every index on its own page", () => {
      expect(pageForRowIndex({ index: 7, pageSize: 1 })).toEqual({
        page: 8,
        indexOnPage: 0,
      });
    });
  });
});
