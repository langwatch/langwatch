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

    it("calls isEnabled with correct arguments including user group", async () => {
      const isEnabledSpy = vi
        .spyOn(service, "isEnabled")
        .mockResolvedValue(false);

      await service.getEnabledFrontendFeatures("user-456");

      expect(isEnabledSpy).toHaveBeenCalledWith(
        "ui-simulations-scenarios",
        "user-456",
        false,
        { groups: { user: "user-456" } },
      );
    });
  });

  describe("getEnabledProjectFeatures", () => {
    let service: FeatureFlagService;

    beforeEach(() => {
      service = FeatureFlagService.create();
    });

    it("returns empty array when no flags enabled", async () => {
      vi.spyOn(service, "isEnabled").mockResolvedValue(false);

      const result = await service.getEnabledProjectFeatures(
        "user-123",
        "project-456",
      );

      expect(result).toEqual([]);
    });

    it("returns array of enabled flag names", async () => {
      vi.spyOn(service, "isEnabled").mockResolvedValue(true);

      const result = await service.getEnabledProjectFeatures(
        "user-123",
        "project-456",
      );

      expect(result).toContain("ui-simulations-scenarios");
    });

    it("calls isEnabled with user and project group options", async () => {
      const isEnabledSpy = vi
        .spyOn(service, "isEnabled")
        .mockResolvedValue(false);

      await service.getEnabledProjectFeatures("user-789", "project-abc");

      expect(isEnabledSpy).toHaveBeenCalledWith(
        "ui-simulations-scenarios",
        "user-789",
        false,
        { groups: { user: "user-789", project: "project-abc" } },
      );
    });

    it("calls isEnabled with user, project, and organization group options", async () => {
      const isEnabledSpy = vi
        .spyOn(service, "isEnabled")
        .mockResolvedValue(false);

      await service.getEnabledProjectFeatures("user-789", "project-abc", "org-xyz");

      expect(isEnabledSpy).toHaveBeenCalledWith(
        "ui-simulations-scenarios",
        "user-789",
        false,
        { groups: { user: "user-789", project: "project-abc", organization: "org-xyz" } },
      );
    });
  });

  describe("isEnabled with options", () => {
    let service: FeatureFlagService;
    let mockService: { isEnabled: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockService = { isEnabled: vi.fn().mockResolvedValue(true) };
      service = FeatureFlagService.create();
      vi.spyOn(service as any, "service", "get").mockReturnValue(mockService);
    });

    it("forwards options to underlying service", async () => {
      const options = { groups: { project: "proj-123" } };

      await service.isEnabled("some-flag", "user-1", true, options);

      expect(mockService.isEnabled).toHaveBeenCalledWith(
        "some-flag",
        "user-1",
        true,
        options,
      );
    });

    it("forwards organization group option", async () => {
      const options = { groups: { organization: "org-456" } };

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
