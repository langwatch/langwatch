/**
 * The trace filter schema is the boundary that decides what an offset-paginating
 * client is told. Before #6808 it accepted `pageOffset`, nothing downstream read
 * it, and the caller got page one with HTTP 200 forever — so these assertions
 * are about the rejection existing at all, and about not over-rejecting the
 * callers that pass a harmless 0.
 */
import { describe, expect, it } from "vitest";

import { getAllForProjectInput, tracesFilterInput } from "../traces.schemas";

const base = {
  projectId: "project_123",
  startDate: 1_700_000_000_000,
  endDate: 1_700_086_400_000,
};

describe("tracesFilterInput", () => {
  describe("given a pageOffset that would page past the first page", () => {
    it("rejects it", () => {
      const result = tracesFilterInput.safeParse({ ...base, pageOffset: 25 });

      expect(result.success).toBe(false);
    });

    it("names scrollId as the replacement so the caller can act on it", () => {
      const result = tracesFilterInput.safeParse({ ...base, pageOffset: 25 });

      expect(result.success).toBe(false);
      if (result.success) return;
      const [issue] = result.error.issues;
      // The wording is copy and may change; that it points at the working
      // mechanism is the contract.
      expect(issue?.message).toContain("scrollId");
      expect(issue?.path).toEqual(["pageOffset"]);
    });

    it("rejects a negative offset too", () => {
      const result = tracesFilterInput.safeParse({ ...base, pageOffset: -1 });

      expect(result.success).toBe(false);
    });
  });

  describe("given the values every non-paginating caller actually sends", () => {
    it("accepts an explicit zero", () => {
      // The UI, the annotations page and the SDKs all send 0 when they are not
      // paginating. Rejecting these would break working clients for no gain.
      const result = tracesFilterInput.safeParse({ ...base, pageOffset: 0 });

      expect(result.success).toBe(true);
    });

    it("accepts the field being absent", () => {
      const result = tracesFilterInput.safeParse({ ...base });

      expect(result.success).toBe(true);
    });
  });

  describe("given a pageSize that cannot become a valid LIMIT", () => {
    it.each([
      ["zero", 0],
      ["negative", -10],
      ["fractional", 2.5],
    ])("rejects a %s page size", (_label, pageSize) => {
      const result = tracesFilterInput.safeParse({ ...base, pageSize });

      expect(result.success).toBe(false);
    });

    it("accepts a positive whole page size", () => {
      const result = tracesFilterInput.safeParse({ ...base, pageSize: 25 });

      expect(result.success).toBe(true);
    });
  });
});

describe("getAllForProjectInput", () => {
  describe("when it extends the filter schema", () => {
    it("carries the pageOffset rejection into the search surface", () => {
      // The public v1 route and the deprecated legacy route both build on this,
      // so the rejection has to survive the extend rather than be re-declared.
      const result = getAllForProjectInput.safeParse({
        ...base,
        pageOffset: 100,
      });

      expect(result.success).toBe(false);
    });

    it("still accepts a scrollId, which is how paging is done now", () => {
      const result = getAllForProjectInput.safeParse({
        ...base,
        scrollId: "eyJsYXN0VGltZXN0YW1wIjoxfQ==",
      });

      expect(result.success).toBe(true);
    });
  });
});
