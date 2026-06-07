import { describe, expect, it } from "vitest";
import {
  isNonBillableTrace,
  NON_BILLABLE_ATTR,
  splitTraceCost,
} from "../costAttribution";

describe("isNonBillableTrace", () => {
  describe("when the non-billable marker is 'true'", () => {
    it("returns true", () => {
      expect(isNonBillableTrace({ [NON_BILLABLE_ATTR]: "true" })).toBe(true);
    });
  });

  describe("when the marker is absent, empty, or 'false'", () => {
    it("returns false", () => {
      expect(isNonBillableTrace({})).toBe(false);
      expect(isNonBillableTrace(undefined)).toBe(false);
      expect(isNonBillableTrace(null)).toBe(false);
      expect(isNonBillableTrace({ [NON_BILLABLE_ATTR]: "false" })).toBe(false);
    });
  });
});

describe("splitTraceCost", () => {
  describe("when the trace is billable", () => {
    it("puts the whole cost in the billed bucket", () => {
      expect(splitTraceCost({ totalCost: 0.42, nonBillable: false })).toEqual({
        billedCost: 0.42,
        nonBilledCost: 0,
      });
    });
  });

  describe("when the trace is non-billable (bundled)", () => {
    it("puts the whole cost in the non-billed bucket", () => {
      expect(splitTraceCost({ totalCost: 0.42, nonBillable: true })).toEqual({
        billedCost: 0,
        nonBilledCost: 0.42,
      });
    });
  });

  describe("when there is no cost", () => {
    it("treats null/undefined as zero", () => {
      expect(splitTraceCost({ totalCost: null, nonBillable: true })).toEqual({
        billedCost: 0,
        nonBilledCost: 0,
      });
      expect(
        splitTraceCost({ totalCost: undefined, nonBillable: false }),
      ).toEqual({ billedCost: 0, nonBilledCost: 0 });
    });
  });
});
