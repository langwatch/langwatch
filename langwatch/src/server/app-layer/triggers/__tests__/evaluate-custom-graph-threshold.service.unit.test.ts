import { describe, expect, it } from "vitest";
import {
  evaluateCustomGraphThreshold,
  isNoDataPredicate,
} from "../evaluate-custom-graph-threshold.service";

describe("evaluateCustomGraphThreshold", () => {
  describe("when operator is gt", () => {
    it("breaches when value is strictly greater than threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 11, threshold: 10, operator: "gt" }),
      ).toEqual({ breached: true });
    });

    it("does not breach when value equals threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 10, threshold: 10, operator: "gt" }),
      ).toEqual({ breached: false });
    });

    it("does not breach when value is below threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 9, threshold: 10, operator: "gt" }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is gte", () => {
    it("breaches when value equals threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 10, threshold: 10, operator: "gte" }),
      ).toEqual({ breached: true });
    });

    it("breaches when value exceeds threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 11, threshold: 10, operator: "gte" }),
      ).toEqual({ breached: true });
    });

    it("does not breach below threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 9, threshold: 10, operator: "gte" }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is lt", () => {
    it("breaches when value is strictly less than threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 9, threshold: 10, operator: "lt" }),
      ).toEqual({ breached: true });
    });

    it("does not breach at threshold boundary", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 10, threshold: 10, operator: "lt" }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is lte", () => {
    it("breaches at threshold boundary", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 10, threshold: 10, operator: "lte" }),
      ).toEqual({ breached: true });
    });

    it("breaches when value is below threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 9, threshold: 10, operator: "lte" }),
      ).toEqual({ breached: true });
    });

    it("does not breach above threshold", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 11, threshold: 10, operator: "lte" }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is eq", () => {
    it("breaches at exact match", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 10, threshold: 10, operator: "eq" }),
      ).toEqual({ breached: true });
    });

    it("breaches within floating-point epsilon", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 10.000_05,
          threshold: 10,
          operator: "eq",
        }),
      ).toEqual({ breached: true });
    });

    it("does not breach beyond epsilon", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 10.001,
          threshold: 10,
          operator: "eq",
        }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is unknown", () => {
    it("does not breach (defensive default)", () => {
      expect(
        evaluateCustomGraphThreshold({ value: 5, threshold: 0, operator: "neq" }),
      ).toEqual({ breached: false });
      expect(
        evaluateCustomGraphThreshold({ value: 5, threshold: 0, operator: "" }),
      ).toEqual({ breached: false });
    });
  });
});

describe("isNoDataPredicate", () => {
  describe("when operator is in the no-data set", () => {
    it("matches lt with threshold 1", () => {
      expect(isNoDataPredicate({ operator: "lt", threshold: 1 })).toBe(true);
    });

    it("matches lte with threshold 0", () => {
      expect(isNoDataPredicate({ operator: "lte", threshold: 0 })).toBe(true);
    });

    it("matches eq with threshold 0", () => {
      expect(isNoDataPredicate({ operator: "eq", threshold: 0 })).toBe(true);
    });

    it("matches lte with threshold 1 (boundary inclusive)", () => {
      expect(isNoDataPredicate({ operator: "lte", threshold: 1 })).toBe(true);
    });

    it("does not match when threshold exceeds 1", () => {
      expect(isNoDataPredicate({ operator: "lt", threshold: 2 })).toBe(false);
      expect(isNoDataPredicate({ operator: "lte", threshold: 100 })).toBe(false);
      expect(isNoDataPredicate({ operator: "eq", threshold: 5 })).toBe(false);
    });
  });

  describe("when operator is not in the no-data set", () => {
    it("does not match gt regardless of threshold", () => {
      expect(isNoDataPredicate({ operator: "gt", threshold: 0 })).toBe(false);
      expect(isNoDataPredicate({ operator: "gt", threshold: 1 })).toBe(false);
    });

    it("does not match gte regardless of threshold", () => {
      expect(isNoDataPredicate({ operator: "gte", threshold: 0 })).toBe(false);
      expect(isNoDataPredicate({ operator: "gte", threshold: 1 })).toBe(false);
    });

    it("does not match unknown operators", () => {
      expect(isNoDataPredicate({ operator: "neq", threshold: 0 })).toBe(false);
      expect(isNoDataPredicate({ operator: "", threshold: 0 })).toBe(false);
    });
  });
});
