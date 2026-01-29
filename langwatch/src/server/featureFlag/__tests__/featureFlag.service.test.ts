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
  describe("isEnabled()", () => {
    let service: FeatureFlagService;

    beforeEach(() => {
      service = FeatureFlagService.create();
    });

    describe("when no env override is set", () => {
      it("delegates to underlying service", async () => {
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

      it("passes projectId to underlying service", async () => {
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

      it("passes organizationId to underlying service", async () => {
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

    describe("when env override is set", () => {
      const originalEnv = process.env;

      beforeEach(() => {
        process.env = { ...originalEnv };
      });

      afterEach(() => {
        process.env = originalEnv;
      });

      describe("when env var is 1", () => {
        it("returns true regardless of default", async () => {
          process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "1";
          const service = FeatureFlagService.create();

          const result = await service.isEnabled(
            "release_ui_simulations_menu_enabled",
            "user-123",
            false,
          );

          expect(result).toBe(true);
        });
      });

      describe("when env var is 0", () => {
        it("returns false regardless of default", async () => {
          process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "0";
          const service = FeatureFlagService.create();

          const result = await service.isEnabled(
            "release_ui_simulations_menu_enabled",
            "user-123",
            true,
          );

          expect(result).toBe(false);
        });
      });
    });
  });
});
