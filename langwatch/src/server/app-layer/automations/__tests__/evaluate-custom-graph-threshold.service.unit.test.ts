import { describe, expect, it } from "vitest";
import {
  evaluateCustomGraphThreshold,
  isNoDataPredicate,
} from "../evaluate-custom-graph-threshold.service";

describe("evaluateCustomGraphThreshold", () => {
  describe("when operator is gt", () => {
    it("breaches when value is strictly greater than threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 11,
          threshold: 10,
          operator: "gt",
        }),
      ).toEqual({ breached: true });
    });

    it("does not breach when value equals threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 10,
          threshold: 10,
          operator: "gt",
        }),
      ).toEqual({ breached: false });
    });

    it("does not breach when value is below threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 9,
          threshold: 10,
          operator: "gt",
        }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is gte", () => {
    it("breaches when value equals threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 10,
          threshold: 10,
          operator: "gte",
        }),
      ).toEqual({ breached: true });
    });

    it("breaches when value exceeds threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 11,
          threshold: 10,
          operator: "gte",
        }),
      ).toEqual({ breached: true });
    });

    it("does not breach below threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 9,
          threshold: 10,
          operator: "gte",
        }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is lt", () => {
    it("breaches when value is strictly less than threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 9,
          threshold: 10,
          operator: "lt",
        }),
      ).toEqual({ breached: true });
    });

    it("does not breach at threshold boundary", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 10,
          threshold: 10,
          operator: "lt",
        }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is lte", () => {
    it("breaches at threshold boundary", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 10,
          threshold: 10,
          operator: "lte",
        }),
      ).toEqual({ breached: true });
    });

    it("breaches when value is below threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 9,
          threshold: 10,
          operator: "lte",
        }),
      ).toEqual({ breached: true });
    });

    it("does not breach above threshold", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 11,
          threshold: 10,
          operator: "lte",
        }),
      ).toEqual({ breached: false });
    });
  });

  describe("when operator is eq", () => {
    it("breaches at exact match", () => {
      expect(
        evaluateCustomGraphThreshold({
          value: 10,
          threshold: 10,
          operator: "eq",
        }),
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
        evaluateCustomGraphThreshold({
          value: 5,
          threshold: 0,
          operator: "neq",
        }),
      ).toEqual({ breached: false });
      expect(
        evaluateCustomGraphThreshold({ value: 5, threshold: 0, operator: "" }),
      ).toEqual({ breached: false });
    });
  });
});

describe("isNoDataPredicate", () => {
  describe("when zero traffic would breach the trigger (cron fired these on silence)", () => {
    it("matches lt with threshold 1", () => {
      expect(isNoDataPredicate({ operator: "lt", threshold: 1 })).toBe(true);
    });

    it("matches lte with threshold 0", () => {
      expect(isNoDataPredicate({ operator: "lte", threshold: 0 })).toBe(true);
    });

    it("matches eq with threshold 0", () => {
      expect(isNoDataPredicate({ operator: "eq", threshold: 0 })).toBe(true);
    });

    it("matches lt with a threshold above 1 — 'count < 10' fires on total silence, exactly as the cron did", () => {
      expect(isNoDataPredicate({ operator: "lt", threshold: 2 })).toBe(true);
      expect(isNoDataPredicate({ operator: "lt", threshold: 10 })).toBe(true);
      expect(isNoDataPredicate({ operator: "lte", threshold: 100 })).toBe(
        true,
      );
    });

    it("matches lte with threshold 1", () => {
      expect(isNoDataPredicate({ operator: "lte", threshold: 1 })).toBe(true);
    });

    it("matches the degenerate gte 0 — always-breached, and the cron fired it on silence too", () => {
      expect(isNoDataPredicate({ operator: "gte", threshold: 0 })).toBe(true);
    });
  });

  describe("when zero traffic would NOT breach the trigger", () => {
    it("does not match eq with a non-zero threshold — silence yields 0, which never equals 5", () => {
      expect(isNoDataPredicate({ operator: "eq", threshold: 5 })).toBe(false);
      expect(isNoDataPredicate({ operator: "eq", threshold: 1 })).toBe(false);
    });

    it("does not match gt regardless of threshold", () => {
      expect(isNoDataPredicate({ operator: "gt", threshold: 0 })).toBe(false);
      expect(isNoDataPredicate({ operator: "gt", threshold: 1 })).toBe(false);
    });

    it("does not match gte with a positive threshold", () => {
      expect(isNoDataPredicate({ operator: "gte", threshold: 1 })).toBe(false);
    });

    it("does not match unknown operators", () => {
      expect(isNoDataPredicate({ operator: "neq", threshold: 0 })).toBe(false);
      expect(isNoDataPredicate({ operator: "", threshold: 0 })).toBe(false);
    });
  });
});
