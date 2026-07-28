import { describe, it, expect } from "vitest";
import { PlanTypes } from "../planTypes";
import { resolveCioPlanLabel, CIO_FREE_PLAN } from "./planLabel";

describe("resolveCioPlanLabel", () => {
  describe("given no active subscription", () => {
    it("returns free for null", () => {
      expect(resolveCioPlanLabel(null)).toBe(CIO_FREE_PLAN);
    });

    it("returns free for undefined", () => {
      expect(resolveCioPlanLabel(undefined)).toBe(CIO_FREE_PLAN);
    });

    it("returns free for the FREE plan", () => {
      expect(resolveCioPlanLabel(PlanTypes.FREE)).toBe(CIO_FREE_PLAN);
    });
  });

  describe("when on a go-forward Growth seat-event plan", () => {
    it("passes the raw plan type through, keeping currency and interval", () => {
      expect(resolveCioPlanLabel(PlanTypes.GROWTH_SEAT_USD_MONTHLY)).toBe(
        "GROWTH_SEAT_USD_MONTHLY",
      );
      expect(resolveCioPlanLabel(PlanTypes.GROWTH_SEAT_EUR_ANNUAL)).toBe(
        "GROWTH_SEAT_EUR_ANNUAL",
      );
      expect(resolveCioPlanLabel(PlanTypes.GROWTH_SEAT_USD_ANNUAL)).toBe(
        "GROWTH_SEAT_USD_ANNUAL",
      );
      expect(resolveCioPlanLabel(PlanTypes.GROWTH_SEAT_EUR_MONTHLY)).toBe(
        "GROWTH_SEAT_EUR_MONTHLY",
      );
    });
  });

  describe("when on a legacy or grandfathered paid plan", () => {
    it("buckets annual variants into seat_event_annual", () => {
      expect(resolveCioPlanLabel(PlanTypes.LAUNCH_ANNUAL)).toBe(
        "seat_event_annual",
      );
      expect(resolveCioPlanLabel(PlanTypes.ACCELERATE_ANNUAL)).toBe(
        "seat_event_annual",
      );
    });

    it("buckets monthly and interval-less variants into seat_event_monthly", () => {
      expect(resolveCioPlanLabel(PlanTypes.LAUNCH)).toBe("seat_event_monthly");
      expect(resolveCioPlanLabel(PlanTypes.ACCELERATE)).toBe(
        "seat_event_monthly",
      );
      expect(resolveCioPlanLabel(PlanTypes.GROWTH)).toBe("seat_event_monthly");
      expect(resolveCioPlanLabel(PlanTypes.PRO)).toBe("seat_event_monthly");
      expect(resolveCioPlanLabel(PlanTypes.ENTERPRISE)).toBe(
        "seat_event_monthly",
      );
    });
  });
});
