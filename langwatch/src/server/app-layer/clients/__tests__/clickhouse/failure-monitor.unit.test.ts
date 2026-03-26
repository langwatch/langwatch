import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FailureRateMonitor } from "../../clickhouse/failure-monitor";

describe("FailureRateMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when failures stay below threshold", () => {
    it("returns false from record()", () => {
      const monitor = new FailureRateMonitor({
        threshold: 5,
        windowMs: 60_000,
      });
      for (let i = 0; i < 4; i++) {
        expect(monitor.record()).toBe(false);
      }
    });
  });

  describe("when failures reach the threshold within the window", () => {
    it("returns true from record()", () => {
      const monitor = new FailureRateMonitor({
        threshold: 5,
        windowMs: 60_000,
      });
      for (let i = 0; i < 4; i++) {
        monitor.record();
      }
      expect(monitor.record()).toBe(true);
    });
  });

  describe("when old failures fall outside the window", () => {
    it("does not count them toward the threshold", () => {
      const monitor = new FailureRateMonitor({
        threshold: 3,
        windowMs: 60_000,
      });
      monitor.record(); // t=0
      monitor.record(); // t=0

      vi.advanceTimersByTime(61_000);

      // Old failures expired, only 1 new one
      expect(monitor.record()).toBe(false);
    });
  });

  describe("when alert fires", () => {
    it("does not fire again until cooldown expires", () => {
      const monitor = new FailureRateMonitor({
        threshold: 2,
        windowMs: 60_000,
      });
      monitor.record();
      expect(monitor.record()).toBe(true); // first alert

      // Immediately add more failures — should NOT alert again
      expect(monitor.record()).toBe(false);
      expect(monitor.record()).toBe(false);
    });

    it("fires again after cooldown expires", () => {
      const monitor = new FailureRateMonitor({
        threshold: 2,
        windowMs: 60_000,
      });
      monitor.record();
      expect(monitor.record()).toBe(true); // first alert

      // Advance past cooldown (default 5 minutes)
      vi.advanceTimersByTime(5 * 60_000 + 1);

      monitor.record();
      expect(monitor.record()).toBe(true); // second alert
    });
  });
});
