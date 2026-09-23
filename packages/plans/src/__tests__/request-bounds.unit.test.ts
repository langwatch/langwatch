import { describe, expect, it } from "vitest";

import { PLAN_TYPES } from "../plan-type.ts";
import {
  ENTERPRISE_PLAN_TYPES,
  findRequestBound,
  FREE_PLAN_TYPES,
  REQUEST_BOUND_KEYS,
  requestBounds,
  resolveRequestBound,
  resolveRequestBoundTier,
} from "../request-bounds.ts";

describe("given the central request-bounds registry", () => {
  describe("when every entry is sanity-checked", () => {
    it("carries positive values that never shrink across the free/paid/enterprise tiers", () => {
      const invalid = requestBounds.filter(
        (bound) =>
          !(bound.free > 0) || !(bound.free <= bound.paid) || !(bound.paid <= bound.enterprise),
      );

      expect(invalid.map((bound) => bound.key)).toEqual([]);
    });

    it("carries unique keys that match the exported key list", () => {
      const keys = requestBounds.map((bound) => bound.key);

      expect(new Set(keys).size).toBe(keys.length);
      expect(REQUEST_BOUND_KEYS).toEqual(keys);
    });

    it("answers every exported key through findRequestBound", () => {
      for (const key of REQUEST_BOUND_KEYS) {
        expect(findRequestBound(key)?.key).toBe(key);
      }
      expect(findRequestBound("no-such-bound")).toBeUndefined();
    });
  });

  describe("when a plan type is mapped to its tier", () => {
    it("answers enterprise for ENTERPRISE and self-hosted OPEN_SOURCE", () => {
      expect(resolveRequestBoundTier("ENTERPRISE")).toBe("enterprise");
      expect(resolveRequestBoundTier("OPEN_SOURCE")).toBe("enterprise");
    });

    it("answers free for FREE, LAUNCH, unknown types and no type at all", () => {
      expect(resolveRequestBoundTier("FREE")).toBe("free");
      expect(resolveRequestBoundTier("LAUNCH")).toBe("free");
      expect(resolveRequestBoundTier("PLATINUM")).toBe("free");
      expect(resolveRequestBoundTier(null)).toBe("free");
      expect(resolveRequestBoundTier(undefined)).toBe("free");
    });

    it("answers paid for every other known plan type", () => {
      const paidTypes = PLAN_TYPES.filter(
        (type) =>
          !ENTERPRISE_PLAN_TYPES.has(type) && !FREE_PLAN_TYPES.has(type) && type !== "OPEN_SOURCE",
      );

      expect(paidTypes).toContain("PRO");
      expect(paidTypes).toContain("GROWTH");
      expect(paidTypes.length).toBeGreaterThan(2);
      for (const type of paidTypes) {
        expect(resolveRequestBoundTier(type)).toBe("paid");
      }
    });
  });

  describe("when a bound is resolved per tier", () => {
    it("answers the registry value of the plan's tier for every known type", () => {
      for (const bound of requestBounds) {
        expect(resolveRequestBound(bound.key, "ENTERPRISE")).toBe(bound.enterprise);
        expect(resolveRequestBound(bound.key, "OPEN_SOURCE")).toBe(bound.enterprise);
        expect(resolveRequestBound(bound.key, "PRO")).toBe(bound.paid);
        expect(resolveRequestBound(bound.key, "GROWTH")).toBe(bound.paid);
        expect(resolveRequestBound(bound.key, "FREE")).toBe(bound.free);
        expect(resolveRequestBound(bound.key, "LAUNCH")).toBe(bound.free);
      }
    });

    it("refuses open to the free tier for an unknown plan type, and for none at all", () => {
      for (const bound of requestBounds) {
        expect(resolveRequestBound(bound.key, "PLATINUM")).toBe(bound.free);
        expect(resolveRequestBound(bound.key, null)).toBe(bound.free);
        expect(resolveRequestBound(bound.key, undefined)).toBe(bound.free);
      }
    });

    it("throws on a key the registry does not carry", () => {
      expect(() => resolveRequestBound("no-such-bound" as never, "ENTERPRISE")).toThrow(
        /Unknown request bound/,
      );
    });
  });

  describe("when boot overrides are merged", () => {
    it("lets a plain-number override win on every tier", () => {
      for (const planType of ["ENTERPRISE", "OPEN_SOURCE", "PRO", "FREE", "PLATINUM"] as const) {
        expect(resolveRequestBound("tracesPageSizeMax", planType, { tracesPageSizeMax: 42 })).toBe(
          42,
        );
      }
    });

    it("lets a partial tier record win only on the tiers it names", () => {
      const overrides = { tracesPageSizeMax: { paid: 3_000 } };

      expect(resolveRequestBound("tracesPageSizeMax", "PRO", overrides)).toBe(3_000);
      expect(resolveRequestBound("tracesPageSizeMax", "GROWTH", overrides)).toBe(3_000);
      expect(resolveRequestBound("tracesPageSizeMax", "ENTERPRISE", overrides)).toBe(4_000);
      expect(resolveRequestBound("tracesPageSizeMax", "OPEN_SOURCE", overrides)).toBe(4_000);
      expect(resolveRequestBound("tracesPageSizeMax", "FREE", overrides)).toBe(1_000);
    });

    it("leaves unoverridden keys on the registry values", () => {
      const overrides = { exportPerMinute: { enterprise: 48 } };

      expect(resolveRequestBound("tracesPageSizeMax", "PRO", overrides)).toBe(2_000);
      expect(resolveRequestBound("exportPerMinute", "ENTERPRISE", overrides)).toBe(48);
      expect(resolveRequestBound("exportPerMinute", "PRO", overrides)).toBe(12);
    });
  });

  describe("when the centralized tier sets are read", () => {
    it("counts ENTERPRISE as the only enterprise type and FREE and LAUNCH as free", () => {
      expect([...ENTERPRISE_PLAN_TYPES]).toEqual(["ENTERPRISE"]);
      expect([...FREE_PLAN_TYPES].toSorted()).toEqual(["FREE", "LAUNCH"]);
    });
  });
});
