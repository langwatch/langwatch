import { describe, expect, it } from "vitest";
import {
  REHYDRATION_WINDOW_MS,
  rehydrationLowerBoundMs,
  TIME_LOCAL_AGGREGATE_TYPES,
} from "../rehydrationWindow";

describe("rehydrationLowerBoundMs", () => {
  const anchor = 1_700_000_000_000;

  describe("when the aggregate type is time-local", () => {
    it("returns the anchor minus the window for a trace", () => {
      expect(rehydrationLowerBoundMs("trace", anchor)).toBe(
        anchor - REHYDRATION_WINDOW_MS,
      );
    });

    it("returns a bound for every time-local type", () => {
      for (const type of TIME_LOCAL_AGGREGATE_TYPES) {
        expect(rehydrationLowerBoundMs(type, anchor)).toBe(
          anchor - REHYDRATION_WINDOW_MS,
        );
      }
    });

    it("never returns a negative bound", () => {
      expect(rehydrationLowerBoundMs("trace", 1000)).toBe(0);
    });
  });

  describe("when the aggregate type is long-lived", () => {
    it("returns undefined (unbounded) for global and billing_report", () => {
      expect(rehydrationLowerBoundMs("global", anchor)).toBeUndefined();
      expect(rehydrationLowerBoundMs("billing_report", anchor)).toBeUndefined();
    });

    it("returns undefined for simulation_set", () => {
      expect(rehydrationLowerBoundMs("simulation_set", anchor)).toBeUndefined();
    });

    it("excludes the long-lived types from the time-local set", () => {
      expect(TIME_LOCAL_AGGREGATE_TYPES.has("global")).toBe(false);
      expect(TIME_LOCAL_AGGREGATE_TYPES.has("billing_report")).toBe(false);
      expect(TIME_LOCAL_AGGREGATE_TYPES.has("simulation_set")).toBe(false);
    });
  });

  describe("when no usable anchor time is available", () => {
    it("returns undefined for an undefined anchor", () => {
      expect(rehydrationLowerBoundMs("trace", undefined)).toBeUndefined();
    });

    it("returns undefined for a zero or negative anchor", () => {
      expect(rehydrationLowerBoundMs("trace", 0)).toBeUndefined();
      expect(rehydrationLowerBoundMs("trace", -5)).toBeUndefined();
    });
  });
});
