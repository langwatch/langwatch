/**
 * The tripwire's whole value is its contract: flag-gated, capped, and — above
 * all — it must NEVER throw into the measure/report path. These tests pin that.
 *
 * @see specs/data-retention/storage-billing-tripwire.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWarn, createMockLogger } = vi.hoisted(() => {
  const mockWarn = vi.fn();
  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });
  return { mockWarn, createMockLogger };
});

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

import { StorageBillingTripwire } from "../storageBillingTripwire";

const SEALED = new Date("2026-02-15T11:00:00.000Z");

function makeTripwire(
  overrides: Partial<{
    enabled: boolean;
    reference: number | null;
    computeReference: () => Promise<number | null>;
    toleranceRatio: number;
    maxLogs: number;
    now: () => number;
  }> = {},
) {
  return new StorageBillingTripwire({
    isEnabled: vi.fn().mockResolvedValue(overrides.enabled ?? true),
    computeReference:
      overrides.computeReference ??
      vi.fn().mockResolvedValue(overrides.reference ?? null),
    toleranceRatio: overrides.toleranceRatio,
    maxLogs: overrides.maxLogs,
    now: overrides.now,
  });
}

describe("StorageBillingTripwire", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given the tripwire flag is off", () => {
    /** @scenario A disabled tripwire does nothing */
    it("computes no reference and logs nothing", async () => {
      const computeReference = vi.fn();
      const tw = makeTripwire({ enabled: false, computeReference });

      await tw.check({
        organizationId: "o",
        sealedHour: SEALED,
        measuredBytes: 100,
      });

      expect(computeReference).not.toHaveBeenCalled();
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe("given no reference is available", () => {
    /** @scenario No reference means no comparison */
    it("logs nothing when the reference is null", async () => {
      const tw = makeTripwire({ reference: null });

      await tw.check({
        organizationId: "o",
        sealedHour: SEALED,
        measuredBytes: 100,
      });

      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe("given the measurement is within tolerance of the reference", () => {
    /** @scenario A measurement within tolerance is silent */
    it("does not warn", async () => {
      const tw = makeTripwire({ reference: 100, toleranceRatio: 0.5 });

      await tw.check({
        organizationId: "o",
        sealedHour: SEALED,
        measuredBytes: 120,
      });

      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe("given the measurement diverges beyond tolerance", () => {
    /** @scenario A divergent measurement is warned once */
    it("warns", async () => {
      const tw = makeTripwire({ reference: 100, toleranceRatio: 0.5 });

      await tw.check({
        organizationId: "o",
        sealedHour: SEALED,
        measuredBytes: 1000,
      });

      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "o", reference: 100 }),
        expect.stringContaining("TRIPWIRE"),
      );
    });

    /** @scenario Divergence logging is capped so a broken reference can't flood logs */
    it("stops logging after the cap", async () => {
      const tw = makeTripwire({
        reference: 100,
        toleranceRatio: 0.5,
        maxLogs: 2,
      });

      for (let i = 0; i < 5; i++) {
        await tw.check({
          organizationId: "o",
          sealedHour: SEALED,
          measuredBytes: 1000,
        });
      }

      expect(mockWarn).toHaveBeenCalledTimes(2);
    });

    /** @scenario The log cap resets each window so later divergence isn't silenced forever */
    it("logs again after the window elapses", async () => {
      let clock = 1_000_000;
      const tw = makeTripwire({
        reference: 100,
        toleranceRatio: 0.5,
        maxLogs: 1,
        now: () => clock,
      });
      const check = () =>
        tw.check({ organizationId: "o", sealedHour: SEALED, measuredBytes: 1000 });

      await check(); // window 1: logs
      await check(); // window 1: capped
      expect(mockWarn).toHaveBeenCalledTimes(1);

      clock += 60 * 60 * 1000 + 1; // advance past the window
      await check(); // window 2: logs again
      expect(mockWarn).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the reference computation throws", () => {
    /** @scenario The tripwire never throws into the measure path */
    it("swallows the error and resolves", async () => {
      const tw = makeTripwire({
        computeReference: vi.fn().mockRejectedValue(new Error("ch down")),
      });

      await expect(
        tw.check({
          organizationId: "o",
          sealedHour: SEALED,
          measuredBytes: 100,
        }),
      ).resolves.toBeUndefined();
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });
});
