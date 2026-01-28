import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeatureFlagService } from "../featureFlag.service";

vi.mock("../featureFlagService.posthog", () => ({
  FeatureFlagServicePostHog: {
    create: () => ({
      isEnabled: vi.fn().mockResolvedValue(false),
    }),
  },
}));

vi.mock("../featureFlagService.memory", () => ({
  FeatureFlagServiceMemory: {
    create: () => ({
      isEnabled: vi.fn().mockResolvedValue(false),
    }),
  },
}));

describe("FeatureFlagService", () => {
  describe("getEnabledFrontendFeatures", () => {
    let service: FeatureFlagService;

    beforeEach(() => {
      service = FeatureFlagService.create();
    });

    it("returns empty array when no flags enabled", async () => {
      vi.spyOn(service, "isEnabled").mockResolvedValue(false);

      const result = await service.getEnabledFrontendFeatures("user-123");

      expect(result).toEqual([]);
    });

    it("returns array of enabled flag names", async () => {
      vi.spyOn(service, "isEnabled").mockResolvedValue(true);

      const result = await service.getEnabledFrontendFeatures("user-123");

      expect(result).toContain("ui-simulations-scenarios");
    });

    it("calls isEnabled with correct arguments", async () => {
      const isEnabledSpy = vi
        .spyOn(service, "isEnabled")
        .mockResolvedValue(false);

      await service.getEnabledFrontendFeatures("user-456");

      expect(isEnabledSpy).toHaveBeenCalledWith(
        "ui-simulations-scenarios",
        "user-456",
        false,
      );
    });
  });

  describe("isEnabled with env override", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    it("returns env override when set to 1", async () => {
      process.env.UI_SIMULATIONS_SCENARIOS = "1";
      const service = FeatureFlagService.create();

      const result = await service.isEnabled(
        "ui-simulations-scenarios",
        "user-123",
        false,
      );

      expect(result).toBe(true);
    });

    it("returns env override when set to 0", async () => {
      process.env.UI_SIMULATIONS_SCENARIOS = "0";
      const service = FeatureFlagService.create();

      const result = await service.isEnabled(
        "ui-simulations-scenarios",
        "user-123",
        true,
      );

      expect(result).toBe(false);
    });

    afterEach(() => {
      process.env = originalEnv;
    });
  });
});
