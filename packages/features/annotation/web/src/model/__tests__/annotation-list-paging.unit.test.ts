/**
 * Which page of a list the address names, and how a page change is written.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANNOTATION_PAGE_SIZE,
  pageAddress,
  pageSizeAddress,
  readAnnotationListPaging,
} from "../annotation-list-paging";

describe("given an address with no paging on it", () => {
  describe("when the list asks which page it is", () => {
    it("reads the first page at the default size", () => {
      expect(readAnnotationListPaging({})).toEqual({
        page: 1,
        pageOffset: 0,
        pageSize: DEFAULT_ANNOTATION_PAGE_SIZE,
      });
    });
  });
});

describe("given an address that names an offset and a size", () => {
  describe("when the list asks which page it is", () => {
    it("turns the offset into a one-based page", () => {
      expect(readAnnotationListPaging({ pageOffset: "50", pageSize: "25" })).toEqual({
        page: 3,
        pageOffset: 50,
        pageSize: 25,
      });
    });
  });

  describe("when the address carries something that is not a number", () => {
    it("falls back rather than paging to NaN", () => {
      expect(readAnnotationListPaging({ pageOffset: "later", pageSize: "-3" })).toEqual({
        page: 1,
        pageOffset: 0,
        pageSize: DEFAULT_ANNOTATION_PAGE_SIZE,
      });
    });
  });
});

describe("given the reviewer moves to another page", () => {
  describe("when the page is not the first", () => {
    it("writes the offset that page starts at", () => {
      expect(pageAddress({ current: { period: "7d" }, page: 3, pageSize: 25 })).toEqual({
        period: "7d",
        pageOffset: "50",
        pageSize: undefined,
      });
    });
  });

  describe("when the page is the first at the default size", () => {
    it("writes neither key, so page one is the bare address", () => {
      const address = pageAddress({
        current: { pageOffset: "50" },
        page: 1,
        pageSize: DEFAULT_ANNOTATION_PAGE_SIZE,
      });

      expect(address.pageOffset).toBeUndefined();
      expect(address.pageSize).toBeUndefined();
    });
  });
});

describe("given the reviewer changes how many rows a page holds", () => {
  /**
   * Keeping the offset would land them partway down a list that has been
   * repaginated under them, at a position the old size described and the new one
   * does not.
   */
  describe("when they were partway down the list", () => {
    it("goes back to the first page", () => {
      expect(
        pageSizeAddress({ current: { pageOffset: "50", pageSize: "25" }, pageSize: 50 }),
      ).toEqual({ pageOffset: undefined, pageSize: "50" });
    });
  });

  describe("when the new size is the default", () => {
    it("takes the size off the address rather than writing the default down", () => {
      expect(
        pageSizeAddress({
          current: { pageSize: "50" },
          pageSize: DEFAULT_ANNOTATION_PAGE_SIZE,
        }).pageSize,
      ).toBeUndefined();
    });
  });
});
