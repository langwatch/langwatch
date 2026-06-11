import {
  ProjectSensitiveDataVisibilityLevel,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserProtectionsForProject } from "../utils";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { PLATFORM_DEFAULT_DATA_PRIVACY } from "~/server/data-privacy/dataPrivacy.types";

vi.mock("../rbac", () => ({
  hasProjectPermission: vi.fn(() => Promise.resolve(true)),
  isDemoProject: vi.fn(() => false),
}));

// Mock the scoped policy resolver so this test exercises only the legacy-enum +
// RoleBinding visibility path; the platform default leaves every category at
// "capture", so reconciliation falls through to the legacy enum.
vi.mock("~/server/data-privacy/dataPrivacyPolicy.service", () => ({
  getDataPrivacyPolicyService: vi.fn(),
}));

const mockOrgService = {
  getUserOrgRoleByTeamId: vi.fn(),
};

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ organizations: mockOrgService }),
}));

const mockPrisma = {
  project: {
    findUniqueOrThrow: vi.fn(),
  },
  roleBinding: {
    findMany: vi.fn(),
  },
} as any;

const mockSession = {
  user: { id: "user-rolebinding-only" },
} as any;

describe("getUserProtectionsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDataPrivacyPolicyService).mockReturnValue({
      getResolvedForProject: vi
        .fn()
        .mockResolvedValue(PLATFORM_DEFAULT_DATA_PRIVACY),
    } as unknown as ReturnType<typeof getDataPrivacyPolicyService>);
  });

  describe("when user has RoleBinding but no TeamUser row", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.MEMBER },
      ]);
    });

    it("grants visibility for VISIBLE_TO_ALL", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    it("queries roleBinding table with team scope", async () => {
      await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(mockPrisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-rolebinding-only",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-1",
        },
        select: { role: true },
      });
    });
  });

  describe("when user has ADMIN RoleBinding", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.ADMIN },
      ]);
    });

    it("grants visibility for VISIBLE_TO_ADMIN", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });
  });

  describe("when user has MEMBER RoleBinding and visibility is VISIBLE_TO_ADMIN", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.MEMBER },
      ]);
    });

    it("denies visibility for non-admin member", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });

  describe("when user has no team RoleBinding and no org membership", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([]);
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue(null);
    });

    it("denies visibility for VISIBLE_TO_ALL", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });

  describe("when user has no team RoleBinding but is org MEMBER", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([]);
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue("MEMBER");
    });

    it("grants visibility for VISIBLE_TO_ALL via org fallback", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    it("denies visibility for VISIBLE_TO_ADMIN", async () => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
      });

      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });

  describe("when user has no team RoleBinding but is org ADMIN", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([]);
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue("ADMIN");
    });

    it("grants visibility for VISIBLE_TO_ADMIN via org admin fallback", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    it("denies visibility for REDACTED_TO_ALL even as org admin", async () => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL,
      });

      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });

  describe("when user has no team RoleBinding but is org EXTERNAL", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([]);
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue("EXTERNAL");
    });

    it("denies visibility even for VISIBLE_TO_ALL", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });

  describe("when visibility is REDACTED_TO_ALL", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.ADMIN },
      ]);
    });

    it("denies visibility even for admin", async () => {
      const result = await getUserProtectionsForProject(
        { prisma: mockPrisma, session: mockSession },
        { projectId: "project-1" },
      );

      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });
});
