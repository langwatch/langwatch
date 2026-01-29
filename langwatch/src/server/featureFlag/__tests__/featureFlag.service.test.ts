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
  describe("isEnabled", () => {
    let service: FeatureFlagService;

    beforeEach(() => {
      service = FeatureFlagService.create();
    });

    it("returns result from underlying service", async () => {
      const mockService = { isEnabled: vi.fn().mockResolvedValue(true) };
      vi.spyOn(service as any, "service", "get").mockReturnValue(mockService);

      const result = await service.isEnabled("some-flag", "user-1", false);

      expect(result).toBe(true);
      expect(mockService.isEnabled).toHaveBeenCalledWith(
        "some-flag",
        "user-1",
        false,
        undefined,
      );
    });

    it("forwards projectId option to underlying service", async () => {
      const mockService = { isEnabled: vi.fn().mockResolvedValue(true) };
      vi.spyOn(service as any, "service", "get").mockReturnValue(mockService);

      const options = { projectId: "proj-123" };
      await service.isEnabled("some-flag", "user-1", true, options);

      expect(mockService.isEnabled).toHaveBeenCalledWith(
        "some-flag",
        "user-1",
        true,
        options,
      );
    });

    it("forwards organizationId option to underlying service", async () => {
      const mockService = { isEnabled: vi.fn().mockResolvedValue(true) };
      vi.spyOn(service as any, "service", "get").mockReturnValue(mockService);

      const options = { organizationId: "org-456" };
      await service.isEnabled("some-flag", "user-1", false, options);

      expect(mockService.isEnabled).toHaveBeenCalledWith(
        "some-flag",
        "user-1",
        false,
        options,
      );
    });
  });

  describe("isEnabled with env override", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    it("returns env override when set to 1", async () => {
      process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "1";
      const service = FeatureFlagService.create();

      const result = await service.isEnabled(
        "release_ui_simulations_menu_enabled",
        "user-123",
        false,
      );

      expect(result).toBe(true);
    });

    it("returns env override when set to 0", async () => {
      process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "0";
      const service = FeatureFlagService.create();

      const result = await service.isEnabled(
        "release_ui_simulations_menu_enabled",
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
