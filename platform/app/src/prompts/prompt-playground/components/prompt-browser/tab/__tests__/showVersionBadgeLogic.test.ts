/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { shouldShowVersionBadge } from "../shouldShowVersionBadge";

describe("showVersionBadge logic", () => {
  describe("when prompt is outdated (behind DB version)", () => {
    it("returns true", () => {
      const result = shouldShowVersionBadge({
        isOutdated: true,
        configId: "config-1",
        allTabsData: [{ configId: "config-1", versionNumber: 3 }],
      });

      expect(result).toBe(true);
    });
  });

  describe("when prompt is at latest version with single tab", () => {
    it("returns false", () => {
      const result = shouldShowVersionBadge({
        isOutdated: false,
        configId: "config-1",
        allTabsData: [{ configId: "config-1", versionNumber: 5 }],
      });

      expect(result).toBe(false);
    });
  });

  describe("when multiple tabs of same prompt at same version", () => {
    it("returns false", () => {
      const result = shouldShowVersionBadge({
        isOutdated: false,
        configId: "config-1",
        allTabsData: [
          { configId: "config-1", versionNumber: 5 },
          { configId: "config-1", versionNumber: 5 },
        ],
      });

      expect(result).toBe(false);
    });
  });

  describe("when multiple tabs of same prompt at different versions", () => {
    it("returns true", () => {
      const result = shouldShowVersionBadge({
        isOutdated: false,
        configId: "config-1",
        allTabsData: [
          { configId: "config-1", versionNumber: 3 },
          { configId: "config-1", versionNumber: 5 },
        ],
      });

      expect(result).toBe(true);
    });
  });

  describe("when tabs are for different prompts", () => {
    it("returns false if not outdated", () => {
      const result = shouldShowVersionBadge({
        isOutdated: false,
        configId: "config-1",
        allTabsData: [
          { configId: "config-1", versionNumber: 5 },
          { configId: "config-2", versionNumber: 3 },
        ],
      });

      expect(result).toBe(false);
    });
  });

  describe("when prompt is new (no configId)", () => {
    it("returns false", () => {
      const result = shouldShowVersionBadge({
        isOutdated: false,
        configId: undefined,
        allTabsData: [{ configId: undefined, versionNumber: undefined }],
      });

      expect(result).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty tabs array", () => {
      const result = shouldShowVersionBadge({
        isOutdated: false,
        configId: "config-1",
        allTabsData: [],
      });

      expect(result).toBe(false);
    });

    it("handles tabs with undefined versionNumber", () => {
      const result = shouldShowVersionBadge({
        isOutdated: false,
        configId: "config-1",
        allTabsData: [
          { configId: "config-1", versionNumber: undefined },
          { configId: "config-1", versionNumber: 5 },
        ],
      });

      // undefined vs 5 = different versions, should show
      expect(result).toBe(true);
    });
  });
});
