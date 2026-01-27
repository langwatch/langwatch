import { describe, expect, it, vi, beforeEach } from "vitest";
import { FeatureFlagService } from "../featureFlag.service";
import { FeatureFlagServiceMemory } from "../featureFlagService.memory";

// Mock the environment to use memory service
vi.mock("~/env.mjs", () => ({
  env: {
    POSTHOG_KEY: undefined,
  },
}));

// Mock langwatch tracer
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: async (
      _name: string,
      _options: unknown,
      fn: (span: { setAttribute: () => void }) => Promise<unknown>,
    ) => fn({ setAttribute: () => {} }),
  }),
}));

// Mock logger
vi.mock("~/utils/logger", () => ({
  createLogger: () => ({
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

describe("FeatureFlagService.getEnabledFlags", () => {
  describe("FeatureFlagServiceMemory", () => {
    let memoryService: FeatureFlagServiceMemory;

    beforeEach(() => {
      memoryService = new FeatureFlagServiceMemory();
    });

    it("returns only enabled flags from the provided list", async () => {
      // Arrange: set up some flags
      memoryService.setFlag("FLAG_A", true);
      memoryService.setFlag("FLAG_B", false);
      memoryService.setFlag("FLAG_C", true);

      // Act
      const result = await memoryService.getEnabledFlags(
        ["FLAG_A", "FLAG_B", "FLAG_C"],
        "user-123",
      );

      // Assert
      expect(result).toEqual(["FLAG_A", "FLAG_C"]);
    });

    it("returns empty array when flagKeys is empty", async () => {
      // Arrange
      memoryService.setFlag("FLAG_A", true);

      // Act
      const result = await memoryService.getEnabledFlags([], "user-123");

      // Assert
      expect(result).toEqual([]);
    });

    it("returns empty array when no flags are enabled", async () => {
      // Arrange: all flags disabled
      memoryService.setFlag("FLAG_A", false);
      memoryService.setFlag("FLAG_B", false);

      // Act
      const result = await memoryService.getEnabledFlags(
        ["FLAG_A", "FLAG_B"],
        "user-123",
      );

      // Assert
      expect(result).toEqual([]);
    });

    it("returns flags that default to true when not explicitly set", async () => {
      // Arrange: FLAG_UNKNOWN is not set, should default to true
      // Act
      const result = await memoryService.getEnabledFlags(
        ["FLAG_UNKNOWN"],
        "user-123",
      );

      // Assert: default is true
      expect(result).toEqual(["FLAG_UNKNOWN"]);
    });
  });

  describe("FeatureFlagService (delegating)", () => {
    it("delegates getEnabledFlags to underlying service", async () => {
      // Arrange
      const service = FeatureFlagService.create();
      const memoryService = service.getService() as FeatureFlagServiceMemory;
      memoryService.setFlag("FEATURE_X", true);
      memoryService.setFlag("FEATURE_Y", false);

      // Act
      const result = await service.getEnabledFlags(
        ["FEATURE_X", "FEATURE_Y"],
        "user-456",
      );

      // Assert
      expect(result).toEqual(["FEATURE_X"]);
    });
  });
});
