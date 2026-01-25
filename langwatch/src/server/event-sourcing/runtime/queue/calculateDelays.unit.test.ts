import { describe, it, expect } from "vitest";
import {
  calculateProgressiveDelay,
  calculateExponentialBackoff,
  calculateLockContentionDelay,
  type ProgressiveDelayConfig,
  type ExponentialBackoffConfig,
  type LockContentionDelayConfig,
} from "./calculateDelays";

describe("calculateProgressiveDelay", () => {
  const config: ProgressiveDelayConfig = {
    baseDelayMs: 100,
    perSequenceDelayMs: 50,
    perAttemptDelayMs: 50,
    maxDelayMs: 5000,
  };

  it("returns base delay plus sequence delay for sequence 1, first attempt", () => {
    // Sequence 1 (prev=0), first attempt (attemptsStarted=1 means 0 completed)
    // 100 + (1 * 50) + (0 * 50) = 150
    expect(calculateProgressiveDelay(0, 1, config)).toBe(150);
  });

  it("increases delay based on sequence number", () => {
    // Sequence 2 (prev=1): 100 + (2 * 50) = 200
    expect(calculateProgressiveDelay(1, 1, config)).toBe(200);
    // Sequence 3 (prev=2): 100 + (3 * 50) = 250
    expect(calculateProgressiveDelay(2, 1, config)).toBe(250);
    // Sequence 5 (prev=4): 100 + (5 * 50) = 350
    expect(calculateProgressiveDelay(4, 1, config)).toBe(350);
  });

  it("increases delay based on completed attempts", () => {
    // Sequence 1, second attempt (1 completed): 100 + (1 * 50) + (1 * 50) = 200
    expect(calculateProgressiveDelay(0, 2, config)).toBe(200);
    // Sequence 1, third attempt (2 completed): 100 + (1 * 50) + (2 * 50) = 250
    expect(calculateProgressiveDelay(0, 3, config)).toBe(250);
  });

  it("combines sequence and attempt-based delays", () => {
    // Sequence 3 (prev=2), third attempt (2 completed)
    // 100 + (3 * 50) + (2 * 50) = 100 + 150 + 100 = 350
    expect(calculateProgressiveDelay(2, 3, config)).toBe(350);
  });

  it("caps delay at maximum", () => {
    expect(calculateProgressiveDelay(100, 100, config)).toBe(5000);
  });

  it("handles null previous sequence as sequence 1", () => {
    // null previous means sequence 1: 100 + (1 * 50) = 150
    expect(calculateProgressiveDelay(null, 1, config)).toBe(150);
  });

  it("treats attemptsStarted of 0 as no completed attempts", () => {
    // attemptsStarted=0 means completedAttempts=max(0, -1)=0
    expect(calculateProgressiveDelay(0, 0, config)).toBe(150);
  });

  it("treats negative attemptsStarted as no completed attempts", () => {
    expect(calculateProgressiveDelay(0, -1, config)).toBe(150);
  });

  it("uses default config when not provided", () => {
    // Default config has same values as test config
    expect(calculateProgressiveDelay(0, 1)).toBe(150);
  });
});

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

describe("calculateLockContentionDelay", () => {
  const config: LockContentionDelayConfig = {
    baseDelayMs: 2000,
    perAttemptDelayMs: 3000,
    maxDelayMs: 30000,
  };

  it("returns base delay for first attempt", () => {
    // attemptsStarted=1 (0 completed): 2000 + (0 * 3000) = 2000
    expect(calculateLockContentionDelay(1, config)).toBe(2000);
  });

  it("adds per-attempt delay for each completed attempt", () => {
    // attemptsStarted=2 (1 completed): 2000 + (1 * 3000) = 5000
    expect(calculateLockContentionDelay(2, config)).toBe(5000);
    // attemptsStarted=3 (2 completed): 2000 + (2 * 3000) = 8000
    expect(calculateLockContentionDelay(3, config)).toBe(8000);
    // attemptsStarted=4 (3 completed): 2000 + (3 * 3000) = 11000
    expect(calculateLockContentionDelay(4, config)).toBe(11000);
  });

  it("caps delay at maximum", () => {
    // attemptsStarted=10 (9 completed): 2000 + (9 * 3000) = 29000
    expect(calculateLockContentionDelay(10, config)).toBe(29000);
    // attemptsStarted=11 (10 completed): 2000 + (10 * 3000) = 32000, capped to 30000
    expect(calculateLockContentionDelay(11, config)).toBe(30000);
    // attemptsStarted=20: way over max
    expect(calculateLockContentionDelay(20, config)).toBe(30000);
  });

  it("treats attemptsStarted of 0 as no completed attempts", () => {
    expect(calculateLockContentionDelay(0, config)).toBe(2000);
  });

  it("treats negative attemptsStarted as no completed attempts", () => {
    expect(calculateLockContentionDelay(-1, config)).toBe(2000);
  });

  it("uses default config when not provided", () => {
    expect(calculateLockContentionDelay(1)).toBe(2000);
  });
});
