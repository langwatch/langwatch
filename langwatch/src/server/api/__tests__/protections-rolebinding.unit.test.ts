import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Audience,
  type Disposition,
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { getUserProtectionsForProject } from "../utils";

vi.mock("../rbac", () => ({
  hasProjectPermission: vi.fn(() => Promise.resolve(true)),
  isDemoProject: vi.fn(() => false),
}));

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

/**
 * The data-privacy policy is the single source of truth for content visibility.
 * Build a resolved policy that sets input/output to a given disposition + audience
 * so the tests drive visibility purely from the policy, not any legacy column.
 */
function policyRestricting(args: {
  input?: { disposition: Disposition; audience?: Audience };
  output?: { disposition: Disposition; audience?: Audience };
}): ResolvedDataPrivacy {
  const toCategory = (setting?: {
    disposition: Disposition;
    audience?: Audience;
  }) =>
    setting
      ? {
          disposition: setting.disposition,
          audience: { ...EMPTY_AUDIENCE, ...setting.audience },
        }
      : {
          disposition: "capture" as Disposition,
          audience: { ...EMPTY_AUDIENCE },
        };
  return {
    ...PLATFORM_DEFAULT_DATA_PRIVACY,
    categories: {
      ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
      input: toCategory(args.input),
      output: toCategory(args.output),
    },
  };
}

function mockPolicy(policy: ResolvedDataPrivacy) {
  vi.mocked(getDataPrivacyPolicyService).mockReturnValue({
    getResolvedForProject: vi.fn().mockResolvedValue(policy),
  } as unknown as ReturnType<typeof getDataPrivacyPolicyService>);
}

const ADMINS: Audience = { admins: true };
const NO_ONE: Audience = {};

describe("getUserProtectionsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
      teamId: "team-1",
    });
    mockPolicy(PLATFORM_DEFAULT_DATA_PRIVACY);
  });

  const protections = () =>
    getUserProtectionsForProject(
      { prisma: mockPrisma, session: mockSession },
      { projectId: "project-1" },
    );

  describe("when the user has a team RoleBinding", () => {
    beforeEach(() => {
      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.MEMBER },
      ]);
    });

    it("grants visibility for captured content (platform default)", async () => {
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    it("queries roleBinding with the project's team scope", async () => {
      await protections();
      expect(mockPrisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-rolebinding-only",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-1",
        },
        select: { role: true },
      });
    });

    it("hides input restricted to admins from a plain member and names the audience", async () => {
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: ADMINS },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.capturedInputVisibleTo).toBe("Admins");
      expect(result.canSeeCapturedOutput).toBe(true);
    });
  });

  describe("when the user has an ADMIN team RoleBinding", () => {
    beforeEach(() => {
      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.ADMIN },
      ]);
    });

    it("shows input restricted to admins", async () => {
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: ADMINS },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.capturedInputVisibleTo).toBeNull();
    });

    it("hides content restricted to no one even from an admin", async () => {
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: NO_ONE },
          output: { disposition: "restrict", audience: NO_ONE },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });

  describe("when the user has no team RoleBinding", () => {
    beforeEach(() => {
      mockPrisma.roleBinding.findMany.mockResolvedValue([]);
    });

    it("denies captured content for a non-member", async () => {
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue(null);
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });

    it("grants captured content via the org MEMBER fallback", async () => {
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue("MEMBER");
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    it("treats an org MEMBER as a non-admin for admin-only restrictions", async () => {
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue("MEMBER");
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: ADMINS },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
    });

    it("treats an org ADMIN as an admin for admin-only restrictions", async () => {
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue("ADMIN");
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: ADMINS },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
    });

    it("denies captured content for an org EXTERNAL", async () => {
      mockOrgService.getUserOrgRoleByTeamId.mockResolvedValue("EXTERNAL");
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });
});
