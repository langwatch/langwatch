/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

/**
 * Pure logic for determining whether to show version badge.
 * Extracted for testing without React hooks complexity.
 */
const shouldShowVersionBadge = (params: {
  isOutdated: boolean;
  configId: string | undefined;
  allTabsData: Array<{ configId?: string; versionNumber?: number }>;
}) => {
  const { isOutdated, configId, allTabsData } = params;

  // If outdated, always show
  if (isOutdated) return true;

  // If no configId, don't show
  if (!configId) return false;

  // Check for duplicate tabs with different versions
  const samePromptTabs = allTabsData.filter((t) => t.configId === configId);
  if (samePromptTabs.length <= 1) return false;

  const versions = new Set(samePromptTabs.map((t) => t.versionNumber));
  return versions.size > 1;
};

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
