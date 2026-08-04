import { describe, expect, it } from "vitest";
import {
  isNonBillableTrace,
  NON_BILLABLE_ATTR,
  resolveNonBilledCost,
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

describe("resolveNonBilledCost", () => {
  describe("when the fold-time amount is present", () => {
    it("uses the folded amount and ignores the legacy boolean", () => {
      // A mixed trace: folded bundled portion is 0.30 of a 1.00 total, even
      // though the legacy boolean marks the whole trace bundled.
      expect(
        resolveNonBilledCost({
          foldedNonBilledCost: 0.3,
          totalCost: 1,
          attributes: { [NON_BILLABLE_ATTR]: "true" },
        }),
      ).toBe(0.3);
    });

    it("clamps the folded amount to [0, totalCost]", () => {
      expect(
        resolveNonBilledCost({
          foldedNonBilledCost: 5,
          totalCost: 1,
          attributes: null,
        }),
      ).toBe(1);
      expect(
        resolveNonBilledCost({
          foldedNonBilledCost: -2,
          totalCost: 1,
          attributes: null,
        }),
      ).toBe(0);
    });
  });

  describe("when the fold-time amount is null (row folded before the column existed)", () => {
    it("falls back to the all-or-nothing legacy boolean", () => {
      expect(
        resolveNonBilledCost({
          foldedNonBilledCost: null,
          totalCost: 0.42,
          attributes: { [NON_BILLABLE_ATTR]: "true" },
        }),
      ).toBe(0.42);
      expect(
        resolveNonBilledCost({
          foldedNonBilledCost: null,
          totalCost: 0.42,
          attributes: {},
        }),
      ).toBe(0);
    });
  });
});
