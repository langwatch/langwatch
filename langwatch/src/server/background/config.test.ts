import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKER_METRICS_PORT, getWorkerMetricsPort } from "./config";

describe("getWorkerMetricsPort", () => {
  const originalEnv = process.env.WORKER_METRICS_PORT;

  beforeEach(() => {
    delete process.env.WORKER_METRICS_PORT;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WORKER_METRICS_PORT;
    } else {
      process.env.WORKER_METRICS_PORT = originalEnv;
    }
  });

  it("returns default port when environment variable is not set", () => {
    expect(getWorkerMetricsPort()).toBe(DEFAULT_WORKER_METRICS_PORT);
  });

  it("returns configured port from environment variable", () => {
    process.env.WORKER_METRICS_PORT = "3001";
    expect(getWorkerMetricsPort()).toBe(3001);
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
