import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKER_METRICS_PORT, getWorkerMetricsPort } from "./config";

describe("getWorkerMetricsPort", () => {
  const originalMetricsEnv = process.env.WORKER_METRICS_PORT;
  const originalPortEnv = process.env.PORT;

  beforeEach(() => {
    delete process.env.WORKER_METRICS_PORT;
    delete process.env.PORT;
  });

  afterEach(() => {
    if (originalMetricsEnv === undefined) {
      delete process.env.WORKER_METRICS_PORT;
    } else {
      process.env.WORKER_METRICS_PORT = originalMetricsEnv;
    }
    if (originalPortEnv === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPortEnv;
    }
  });

  describe("when WORKER_METRICS_PORT is not set", () => {
    it("returns 2999 when PORT is also unset", () => {
      expect(getWorkerMetricsPort()).toBe(DEFAULT_WORKER_METRICS_PORT);
    });

    it("derives default from PORT (PORT - 2561) so non-default slots don't collide", () => {
      process.env.PORT = "5570";
      expect(getWorkerMetricsPort()).toBe(3009);
    });

    it("falls back to 2999 when PORT is non-numeric", () => {
      process.env.PORT = "banana";
      expect(getWorkerMetricsPort()).toBe(DEFAULT_WORKER_METRICS_PORT);
    });
  });

  describe("when WORKER_METRICS_PORT is set", () => {
    it("returns the configured port", () => {
      process.env.WORKER_METRICS_PORT = "3001";
      expect(getWorkerMetricsPort()).toBe(3001);
    });

    it("overrides the PORT-derived default", () => {
      process.env.PORT = "5570";
      process.env.WORKER_METRICS_PORT = "4242";
      expect(getWorkerMetricsPort()).toBe(4242);
    });

    it("throws an error for non-numeric port values", () => {
      process.env.WORKER_METRICS_PORT = "banana";
      expect(() => getWorkerMetricsPort()).toThrow(
        'Invalid WORKER_METRICS_PORT: "banana"'
      );
    });

    it("throws an error for port below valid range", () => {
      process.env.WORKER_METRICS_PORT = "0";
      expect(() => getWorkerMetricsPort()).toThrow(
        'Invalid WORKER_METRICS_PORT: "0"'
      );
    });

    it("throws an error for port above valid range", () => {
      process.env.WORKER_METRICS_PORT = "999999";
      expect(() => getWorkerMetricsPort()).toThrow(
        'Invalid WORKER_METRICS_PORT: "999999"'
      );
    });

    it("accepts valid port at lower boundary", () => {
      process.env.WORKER_METRICS_PORT = "1";
      expect(getWorkerMetricsPort()).toBe(1);
    });

    it("accepts valid port at upper boundary", () => {
      process.env.WORKER_METRICS_PORT = "65535";
      expect(getWorkerMetricsPort()).toBe(65535);
    });
  });
});
