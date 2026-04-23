import {
  ProjectSensitiveDataVisibilityLevel,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserProtectionsForProject } from "../utils";

vi.mock("../rbac", () => ({
  hasProjectPermission: vi.fn(() => Promise.resolve(true)),
  isDemoProject: vi.fn(() => false),
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

  describe("when user has no RoleBinding", () => {
    beforeEach(() => {
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
        teamId: "team-1",
        capturedInputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        capturedOutputVisibility:
          ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      });

      mockPrisma.roleBinding.findMany.mockResolvedValue([]);
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
