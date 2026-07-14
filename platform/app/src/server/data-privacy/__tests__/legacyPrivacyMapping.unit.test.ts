import { describe, expect, it } from "vitest";

import {
  mapLegacyContentModeToConfig,
  mapLegacyProjectToConfig,
} from "../legacyPrivacyMapping";

const DEFAULT_PROJECT = {
  capturedInputVisibility: "VISIBLE_TO_ALL",
  capturedOutputVisibility: "VISIBLE_TO_ALL",
  piiRedactionLevel: "ESSENTIAL",
} as const;

describe("legacy privacy mapping", () => {
  describe("given the organization content mode dropped inputs and outputs", () => {
    /** @scenario The organization content mode becomes an organization drop rule */
    it("maps to an organization drop rule for input and output", () => {
      const config = mapLegacyContentModeToConfig("strip_io");

      expect(config?.categories?.input?.disposition).toBe("drop");
      expect(config?.categories?.output?.disposition).toBe("drop");
    });
  });

  describe("given captured input was visible to admins only", () => {
    /** @scenario Admin-only captured input becomes a project restrict rule */
    it("maps to a project rule restricting input to admins", () => {
      const config = mapLegacyProjectToConfig({
        ...DEFAULT_PROJECT,
        capturedInputVisibility: "VISIBLE_TO_ADMIN",
      });

      expect(config?.categories?.input?.disposition).toBe("restrict");
      expect(config?.categories?.input?.audience).toEqual({ admins: true });
    });
  });

  describe("given captured output was redacted to everyone", () => {
    /** @scenario Fully-redacted captured output becomes a restrict-to-no-one rule */
    it("maps to a project rule restricting output to no one", () => {
      const config = mapLegacyProjectToConfig({
        ...DEFAULT_PROJECT,
        capturedOutputVisibility: "REDACTED_TO_ALL",
      });

      expect(config?.categories?.output?.disposition).toBe("restrict");
      expect(config?.categories?.output?.audience).toEqual({});
    });
  });

  describe("given the project PII level was strict", () => {
    /** @scenario The project PII level is preserved */
    it("maps to a strict PII level", () => {
      const config = mapLegacyProjectToConfig({
        ...DEFAULT_PROJECT,
        piiRedactionLevel: "STRICT",
      });

      expect(config?.pii?.level).toBe("strict");
    });
  });

  describe("given all legacy privacy controls were at their defaults", () => {
    /** @scenario A project with default legacy settings needs no rule */
    it("produces no rule", () => {
      expect(mapLegacyProjectToConfig(DEFAULT_PROJECT)).toBeNull();
      expect(mapLegacyContentModeToConfig("full")).toBeNull();
    });
  });
});
