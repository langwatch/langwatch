import { resolveRequestBound } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { traceLegacySearchBodySchema } from "../trace-legacy-search-body.rules.ts";

const ENTERPRISE_PAGE_SIZE = resolveRequestBound("tracesPageSizeMax", "ENTERPRISE");

const body = { startDate: 1_000, endDate: 2_000 };

describe("traceLegacySearchBodySchema", () => {
  describe("given a pageSize above every plan's page bound", () => {
    /** @scenario "Public trace search clamps an oversized page instead of rejecting it" */
    it("accepts it, since the read clamps instead of refusing", () => {
      expect(
        traceLegacySearchBodySchema.validate({
          ...body,
          pageSize: Math.max(5_000, ENTERPRISE_PAGE_SIZE + 1),
        }),
      ).toBe(true);
    });
  });

  describe("given no pageSize", () => {
    it("accepts it", () => {
      expect(traceLegacySearchBodySchema.validate(body)).toBe(true);
    });
  });

  describe.each([
    ["zero", 0],
    ["fractional", 2.5],
  ])("given a %s pageSize", (_label, pageSize) => {
    it("refuses it", () => {
      expect(traceLegacySearchBodySchema.validate({ ...body, pageSize })).toBe(false);
    });
  });
});
