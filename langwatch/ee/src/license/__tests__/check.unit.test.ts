/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSelfHostedPlan,
  isEeEnabled,
  hasPaidLicense,
} from "../check";
import type { SelfHostedPlan } from "../types";

describe("License Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getSelfHostedPlan", () => {
    it("returns self-hosted:oss when no LICENSE_KEY is set", () => {
      delete process.env.LICENSE_KEY;

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:oss");
    });

    it("returns self-hosted:enterprise for LW-ENT- prefixed key", () => {
      process.env.LICENSE_KEY = "LW-ENT-abc123";

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:enterprise");
    });

    it("returns self-hosted:pro for LW-PRO- prefixed key", () => {
      process.env.LICENSE_KEY = "LW-PRO-xyz789";

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:pro");
    });

    it("returns self-hosted:oss for invalid license key format", () => {
      process.env.LICENSE_KEY = "invalid-key-format";

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:oss");
    });

    it("returns self-hosted:oss for empty string LICENSE_KEY", () => {
      process.env.LICENSE_KEY = "";

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:oss");
    });
  });

  describe("isEeEnabled", () => {
    it("returns true for enterprise plan", () => {
      process.env.LICENSE_KEY = "LW-ENT-test";

      const result = isEeEnabled();

      expect(result).toBe(true);
    });

    it("returns false for OSS plan", () => {
      delete process.env.LICENSE_KEY;

      const result = isEeEnabled();

      expect(result).toBe(false);
    });

    it("returns false for pro plan", () => {
      process.env.LICENSE_KEY = "LW-PRO-test";

      const result = isEeEnabled();

      expect(result).toBe(false);
    });
  });

  describe("hasPaidLicense", () => {
    it("returns true for enterprise plan", () => {
      process.env.LICENSE_KEY = "LW-ENT-test";

      const result = hasPaidLicense();

      expect(result).toBe(true);
    });

    it("returns true for pro plan", () => {
      process.env.LICENSE_KEY = "LW-PRO-test";

      const result = hasPaidLicense();

      expect(result).toBe(true);
    });

    it("returns false for OSS plan", () => {
      delete process.env.LICENSE_KEY;

      const result = hasPaidLicense();

      expect(result).toBe(false);
    });
  });
});
