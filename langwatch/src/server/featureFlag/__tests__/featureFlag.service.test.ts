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
      const originalEnvValue = process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;

      beforeEach(() => {
        delete process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;
      });

      afterEach(() => {
        if (originalEnvValue === undefined) {
          delete process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;
        } else {
          process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = originalEnvValue;
        }
      });

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

    describe("when FEATURE_FLAG_FORCE_ENABLE is set", () => {
      const originalEnv = process.env;

      beforeEach(() => {
        process.env = { ...originalEnv };
      });

      afterEach(() => {
        process.env = originalEnv;
      });

      it("forces matching flag on regardless of underlying service", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "some_flag,other_flag";
        const service = FeatureFlagService.create();
        const mockSub = { isEnabled: vi.fn().mockResolvedValue(false) };
        vi.spyOn(service as any, "service", "get").mockReturnValue(mockSub);

        const result = await service.isEnabled("some_flag", "user-1", false);

        expect(result).toBe(true);
        expect(mockSub.isEnabled).not.toHaveBeenCalled();
      });

      it("does not force flags that are not in the list", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "only_this_flag";
        const service = FeatureFlagService.create();
        const mockSub = { isEnabled: vi.fn().mockResolvedValue(false) };
        vi.spyOn(service as any, "service", "get").mockReturnValue(mockSub);

        const result = await service.isEnabled("different_flag", "u", false);

        expect(result).toBe(false);
        expect(mockSub.isEnabled).toHaveBeenCalled();
      });

      it("trims whitespace in the comma-separated list", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "  spaced_flag  , other ";
        const service = FeatureFlagService.create();
        const mockSub = { isEnabled: vi.fn().mockResolvedValue(false) };
        vi.spyOn(service as any, "service", "get").mockReturnValue(mockSub);

        const result = await service.isEnabled("spaced_flag", "u", false);

        expect(result).toBe(true);
      });

      it("runs at the top level so dev memory sub-service is bypassed", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "release_ui_ai_gateway_menu_enabled";
        delete process.env.POSTHOG_KEY;
        const service = FeatureFlagService.create();
        const mockMemorySub = { isEnabled: vi.fn().mockResolvedValue(false) };
        vi.spyOn(service as any, "service", "get").mockReturnValue(
          mockMemorySub,
        );

        const result = await service.isEnabled(
          "release_ui_ai_gateway_menu_enabled",
          "u",
          false,
        );

        expect(result).toBe(true);
        expect(mockMemorySub.isEnabled).not.toHaveBeenCalled();
      });

      it("per-flag envOverride takes precedence over FEATURE_FLAG_FORCE_ENABLE", async () => {
        process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "0";
        process.env.FEATURE_FLAG_FORCE_ENABLE = "release_ui_simulations_menu_enabled";
        const service = FeatureFlagService.create();

        const result = await service.isEnabled(
          "release_ui_simulations_menu_enabled",
          "u",
          true,
        );

        expect(result).toBe(false);
      });
    });
  });
});
