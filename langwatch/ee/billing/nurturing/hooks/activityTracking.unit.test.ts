import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireActivityTrackingNurturing,
  resetActivityTrackingCache,
  getActivityTrackingCacheSize,
} from "./activityTracking";

// Suppress logger output
vi.mock("../../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

const mockNurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

let currentNurturing: typeof mockNurturing | undefined = mockNurturing;

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    get nurturing() {
      return currentNurturing;
    },
  }),
}));

describe("Activity tracking hook", () => {
  describe("given an active NurturingService", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      currentNurturing = mockNurturing;
      resetActivityTrackingCache();
      vi.useRealTimers();
    });

    describe("when the auth session callback fires", () => {
      it("identifies user with last_active_at set to the current time", () => {
        const now = new Date("2026-03-15T12:00:00.000Z");
        vi.setSystemTime(now);

        fireActivityTrackingNurturing({ userId: "user-1" });

        expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: { last_active_at: "2026-03-15T12:00:00.000Z" },
        });

        vi.useRealTimers();
      });
    });

    describe("when a user refreshes their session multiple times within one hour", () => {
      it("makes at most one Customer.io identify call per hour", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));

        fireActivityTrackingNurturing({ userId: "user-1" });
        fireActivityTrackingNurturing({ userId: "user-1" });
        fireActivityTrackingNurturing({ userId: "user-1" });

        expect(mockNurturing.identifyUser).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
      });

      it("allows a new call after one hour has passed", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));

        fireActivityTrackingNurturing({ userId: "user-1" });
        expect(mockNurturing.identifyUser).toHaveBeenCalledTimes(1);

        // Advance past the 1-hour debounce window
        vi.advanceTimersByTime(60 * 60 * 1000 + 1);

        fireActivityTrackingNurturing({ userId: "user-1" });
        expect(mockNurturing.identifyUser).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
      });

      it("tracks separate users independently", () => {
        fireActivityTrackingNurturing({ userId: "user-1" });
        fireActivityTrackingNurturing({ userId: "user-2" });

        expect(mockNurturing.identifyUser).toHaveBeenCalledTimes(2);
      });
    });

    describe("when expired entries accumulate in the debounce cache", () => {
      it("evicts entries older than one hour during the next call", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));

        // Populate cache with multiple users
        fireActivityTrackingNurturing({ userId: "user-1" });
        fireActivityTrackingNurturing({ userId: "user-2" });
        fireActivityTrackingNurturing({ userId: "user-3" });
        expect(getActivityTrackingCacheSize()).toBe(3);

        // Advance past the 1-hour window so entries are expired
        vi.advanceTimersByTime(60 * 60 * 1000 + 1);

        // Next call triggers sweep and evicts expired entries
        fireActivityTrackingNurturing({ userId: "user-4" });

        // Only user-4 remains (user-1..3 were evicted by sweep)
        expect(getActivityTrackingCacheSize()).toBe(1);

        vi.useRealTimers();
      });

      it("does not sweep more than once per hour", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));

        // First call triggers sweep (lastSweepAt is 0)
        fireActivityTrackingNurturing({ userId: "user-1" });
        expect(getActivityTrackingCacheSize()).toBe(1);

        // Advance 30 minutes — not enough for another sweep
        vi.advanceTimersByTime(30 * 60 * 1000);
        fireActivityTrackingNurturing({ userId: "user-2" });
        expect(getActivityTrackingCacheSize()).toBe(2);

        // Advance another 31 minutes (total 61 min from start)
        // user-1 is now expired but sweep hasn't run since 30min mark
        vi.advanceTimersByTime(31 * 60 * 1000);
        fireActivityTrackingNurturing({ userId: "user-3" });

        // Sweep should have run: user-1 expired (61 min old), user-2 still valid (31 min old)
        // user-3 just added. So cache = user-2 + user-3 = 2
        expect(getActivityTrackingCacheSize()).toBe(2);

        vi.useRealTimers();
      });
    });

    describe("when Customer.io API is unavailable", () => {
      it("does not throw (fire-and-forget)", async () => {
        const { captureException } = await import(
          "../../../../src/utils/posthogErrorCapture"
        );
        mockNurturing.identifyUser.mockRejectedValueOnce(
          new Error("CIO unavailable"),
        );

        expect(() =>
          fireActivityTrackingNurturing({ userId: "user-1" }),
        ).not.toThrow();

        await vi.waitFor(() => {
          expect(captureException).toHaveBeenCalled();
        });
      });
    });
  });

  describe("given nurturing is undefined", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      currentNurturing = undefined;
      resetActivityTrackingCache();
    });

    describe("when the auth session callback fires", () => {
      it("silently skips without calling any nurturing methods", () => {
        fireActivityTrackingNurturing({ userId: "user-1" });

        expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      });
    });
  });
});
