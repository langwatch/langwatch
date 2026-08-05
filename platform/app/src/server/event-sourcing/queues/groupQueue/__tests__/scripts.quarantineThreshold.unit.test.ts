import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_QUARANTINE_THRESHOLD,
  readGroupQuarantineThreshold,
} from "../scripts";

const ENV = "LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD";

describe("readGroupQuarantineThreshold", () => {
  const previous = process.env[ENV];

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV];
    else process.env[ENV] = previous;
  });

  describe("when the env var is unset", () => {
    it("falls back to the default threshold", () => {
      delete process.env[ENV];
      expect(readGroupQuarantineThreshold()).toBe(
        DEFAULT_GROUP_QUARANTINE_THRESHOLD,
      );
    });
  });

  describe("when the env var is the kill switch 0", () => {
    it("returns 0 so the breaker is disabled", () => {
      process.env[ENV] = "0";
      expect(readGroupQuarantineThreshold()).toBe(0);
    });
  });

  describe("when the env var is a positive integer", () => {
    it("returns that integer", () => {
      process.env[ENV] = "42";
      expect(readGroupQuarantineThreshold()).toBe(42);
    });
  });

  describe("when the env var is non-numeric or negative", () => {
    it("falls back to the default rather than disabling the breaker", () => {
      process.env[ENV] = "not-a-number";
      expect(readGroupQuarantineThreshold()).toBe(
        DEFAULT_GROUP_QUARANTINE_THRESHOLD,
      );
      process.env[ENV] = "-5";
      expect(readGroupQuarantineThreshold()).toBe(
        DEFAULT_GROUP_QUARANTINE_THRESHOLD,
      );
    });
  });
});
