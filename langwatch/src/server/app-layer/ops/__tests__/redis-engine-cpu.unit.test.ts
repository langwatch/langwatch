import { describe, expect, it } from "vitest";
import {
  computeEngineCpuPercent,
  type RedisCpuSample,
} from "../redis-engine-cpu";

const prev = (overrides: Partial<RedisCpuSample> = {}): RedisCpuSample => ({
  userSec: 100,
  sysSec: 50,
  sampledAt: 1_000_000,
  ...overrides,
});

describe("computeEngineCpuPercent", () => {
  describe("given there is no previous sample", () => {
    it("returns null on the first cycle", () => {
      const result = computeEngineCpuPercent({
        prev: null,
        nextUserSec: 100,
        nextSysSec: 50,
        nextSampledAt: 1_000_000,
      });
      expect(result).toBeNull();
    });
  });

  describe("given two samples 1000ms apart", () => {
    it("returns 40 when 0.3s user + 0.1s sys CPU was used", () => {
      const result = computeEngineCpuPercent({
        prev: prev({ userSec: 100, sysSec: 50, sampledAt: 1_000_000 }),
        nextUserSec: 100.3,
        nextSysSec: 50.1,
        nextSampledAt: 1_001_000,
      });
      expect(result).toBeCloseTo(40, 1);
    });

    it("returns 0 when CPU counters did not advance at all", () => {
      const result = computeEngineCpuPercent({
        prev: prev({ userSec: 100, sysSec: 50, sampledAt: 1_000_000 }),
        nextUserSec: 100,
        nextSysSec: 50,
        nextSampledAt: 1_001_000,
      });
      expect(result).toBe(0);
    });

    it("rounds the result to one decimal place", () => {
      // 0.12349s of CPU over 1.0s wall = 12.349% → rounded to 12.3
      const result = computeEngineCpuPercent({
        prev: prev({ userSec: 100, sysSec: 50, sampledAt: 1_000_000 }),
        nextUserSec: 100.12349,
        nextSysSec: 50,
        nextSampledAt: 1_001_000,
      });
      expect(result).toBe(12.3);
    });
  });

  describe("given the cumulative CPU counter went backwards", () => {
    it("returns null because Redis was restarted between samples", () => {
      const result = computeEngineCpuPercent({
        prev: prev({ userSec: 1000, sysSec: 500, sampledAt: 1_000_000 }),
        nextUserSec: 5,
        nextSysSec: 2,
        nextSampledAt: 1_001_000,
      });
      expect(result).toBeNull();
    });

    it("resumes computing percent on the cycle after the rewind", () => {
      // Cycle N: prev=1000, next=5  → returns null (rewind detected)
      // Cycle N+1: prev=5, next=5.4 → returns 40
      const afterRewind = computeEngineCpuPercent({
        prev: prev({ userSec: 5, sysSec: 2, sampledAt: 1_001_000 }),
        nextUserSec: 5.3,
        nextSysSec: 2.1,
        nextSampledAt: 1_002_000,
      });
      expect(afterRewind).toBeCloseTo(40, 1);
    });
  });

  describe("given two samples taken at the same instant", () => {
    it("returns null instead of dividing by zero", () => {
      const result = computeEngineCpuPercent({
        prev: prev({ sampledAt: 1_000_000 }),
        nextUserSec: 100.3,
        nextSysSec: 50.1,
        nextSampledAt: 1_000_000,
      });
      expect(result).toBeNull();
    });

    it("returns null if the next sampledAt somehow goes backwards", () => {
      const result = computeEngineCpuPercent({
        prev: prev({ sampledAt: 1_000_000 }),
        nextUserSec: 100.3,
        nextSysSec: 50.1,
        nextSampledAt: 999_999,
      });
      expect(result).toBeNull();
    });
  });
});
