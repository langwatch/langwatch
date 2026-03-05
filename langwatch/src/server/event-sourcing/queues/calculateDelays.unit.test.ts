import { describe, it, expect } from "vitest";
import {
  calculateExponentialBackoff,
  type ExponentialBackoffConfig,
} from "./calculateDelays";

describe("calculateExponentialBackoff", () => {
  const config: ExponentialBackoffConfig = {
    baseDelayMs: 2000,
    multiplier: 2,
    maxDelayMs: 60000,
  };

  it("returns base delay for first attempt", () => {
    // attemptsStarted=1 means 0 completed: 2000 * 2^0 = 2000
    expect(calculateExponentialBackoff(1, config)).toBe(2000);
  });

  it("doubles delay for each completed attempt", () => {
    // attemptsStarted=2 (1 completed): 2000 * 2^1 = 4000
    expect(calculateExponentialBackoff(2, config)).toBe(4000);
    // attemptsStarted=3 (2 completed): 2000 * 2^2 = 8000
    expect(calculateExponentialBackoff(3, config)).toBe(8000);
    // attemptsStarted=4 (3 completed): 2000 * 2^3 = 16000
    expect(calculateExponentialBackoff(4, config)).toBe(16000);
    // attemptsStarted=5 (4 completed): 2000 * 2^4 = 32000
    expect(calculateExponentialBackoff(5, config)).toBe(32000);
  });

  it("caps delay at maximum", () => {
    // attemptsStarted=6 (5 completed): 2000 * 2^5 = 64000, capped to 60000
    expect(calculateExponentialBackoff(6, config)).toBe(60000);
    // attemptsStarted=10 (9 completed): way over max
    expect(calculateExponentialBackoff(10, config)).toBe(60000);
  });

  it("treats attemptsStarted of 0 as no completed attempts", () => {
    expect(calculateExponentialBackoff(0, config)).toBe(2000);
  });

  it("treats negative attemptsStarted as no completed attempts", () => {
    expect(calculateExponentialBackoff(-1, config)).toBe(2000);
  });

  it("uses default config when not provided", () => {
    expect(calculateExponentialBackoff(1)).toBe(2000);
  });
});
