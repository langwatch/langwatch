import type { PrismaClient } from "@prisma/client";
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

      expect(result).toContain("release_ui_simulations_menu_enabled");
    });

    it("calls isEnabled with correct arguments for user-level check", async () => {
      const isEnabledSpy = vi
        .spyOn(service, "isEnabled")
        .mockResolvedValue(false);

      await service.getEnabledFrontendFeatures("user-456");

      expect(isEnabledSpy).toHaveBeenCalledWith(
        "release_ui_simulations_menu_enabled",
        "user-456",
        false,
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

      expect(result).toContain("release_ui_simulations_menu_enabled");
    });

    it("calls isEnabled with project personProperties", async () => {
      const isEnabledSpy = vi
        .spyOn(service, "isEnabled")
        .mockResolvedValue(false);

      await service.getEnabledProjectFeatures("user-789", "project-abc");

      expect(isEnabledSpy).toHaveBeenCalledWith(
        "release_ui_simulations_menu_enabled",
        "user-789",
        false,
        { projectId: "project-abc", organizationId: undefined },
      );
    });

    it("calls isEnabled with project and organization personProperties", async () => {
      const isEnabledSpy = vi
        .spyOn(service, "isEnabled")
        .mockResolvedValue(false);

      await service.getEnabledProjectFeatures("user-789", "project-abc", "org-xyz");

      expect(isEnabledSpy).toHaveBeenCalledWith(
        "release_ui_simulations_menu_enabled",
        "user-789",
        false,
        { projectId: "project-abc", organizationId: "org-xyz" },
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

    it("forwards projectId option to underlying service", async () => {
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

  describe("getSessionFeatures", () => {
    let service: FeatureFlagService;
    let mockPrisma: { project: { findMany: ReturnType<typeof vi.fn> } };

    beforeEach(() => {
      service = FeatureFlagService.create();
      mockPrisma = {
        project: {
          findMany: vi.fn(),
        },
      };
    });

    it("returns empty features when user has no projects", async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      vi.spyOn(service, "getEnabledFrontendFeatures").mockResolvedValue([]);

      const result = await service.getSessionFeatures(
        "user-123",
        mockPrisma as unknown as PrismaClient,
      );

      expect(result).toEqual({
        enabledFeatures: [],
        projectFeatures: {},
      });
    });

    it("returns user features and project features", async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: "project-1", team: { organizationId: "org-1" } },
        { id: "project-2", team: { organizationId: null } },
      ]);
      vi.spyOn(service, "getEnabledFrontendFeatures").mockResolvedValue([
        "release_ui_simulations_menu_enabled",
      ]);
      vi.spyOn(service, "getEnabledProjectFeatures")
        .mockResolvedValueOnce(["release_ui_simulations_menu_enabled"])
        .mockResolvedValueOnce([]);

      const result = await service.getSessionFeatures(
        "user-456",
        mockPrisma as unknown as PrismaClient,
      );

      expect(result).toEqual({
        enabledFeatures: ["release_ui_simulations_menu_enabled"],
        projectFeatures: {
          "project-1": ["release_ui_simulations_menu_enabled"],
          "project-2": [],
        },
      });
    });

    it("queries projects with correct filters", async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      vi.spyOn(service, "getEnabledFrontendFeatures").mockResolvedValue([]);

      await service.getSessionFeatures(
        "user-789",
        mockPrisma as unknown as PrismaClient,
      );

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith({
        where: {
          team: { members: { some: { userId: "user-789" } }, archivedAt: null },
          archivedAt: null,
        },
        select: { id: true, team: { select: { organizationId: true } } },
      });
    });

    it("passes organizationId as undefined when null", async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: "project-1", team: { organizationId: null } },
      ]);
      vi.spyOn(service, "getEnabledFrontendFeatures").mockResolvedValue([]);
      const getProjectFeaturesSpy = vi
        .spyOn(service, "getEnabledProjectFeatures")
        .mockResolvedValue([]);

      await service.getSessionFeatures(
        "user-123",
        mockPrisma as unknown as PrismaClient,
      );

      expect(getProjectFeaturesSpy).toHaveBeenCalledWith(
        "user-123",
        "project-1",
        undefined,
      );
    });

    it("passes organizationId when present", async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: "project-1", team: { organizationId: "org-abc" } },
      ]);
      vi.spyOn(service, "getEnabledFrontendFeatures").mockResolvedValue([]);
      const getProjectFeaturesSpy = vi
        .spyOn(service, "getEnabledProjectFeatures")
        .mockResolvedValue([]);

      await service.getSessionFeatures(
        "user-123",
        mockPrisma as unknown as PrismaClient,
      );

      expect(getProjectFeaturesSpy).toHaveBeenCalledWith(
        "user-123",
        "project-1",
        "org-abc",
      );
    });
  });
});
