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

vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeProjectPermission: vi.fn(() => Promise.resolve(true)),
  isDemoProject: vi.fn(() => false),
}));

vi.mock("~/server/data-privacy/dataPrivacyPolicy.service", () => ({
  getDataPrivacyPolicyService: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({}),
  // Reached through the TtlCache these paths read; null keeps it in-memory.
  tryGetApp: () => null,
}));

const mockPrisma = {
  project: {
    findUniqueOrThrow: vi.fn(),
  },
  grant: {
    findMany: vi.fn(),
  },
  roleBinding: { findMany: vi.fn() },
  teamUser: { findMany: vi.fn() },
  organizationUser: { findFirst: vi.fn() },
  groupMembership: {
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
      ownerUserId: null,
      team: { organizationId: "org-1" },
    });
    mockPolicy(PLATFORM_DEFAULT_DATA_PRIVACY);
    mockPrisma.groupMembership.findMany.mockResolvedValue([]);
  });

  const protections = () =>
    getUserProtectionsForProject(
      { prisma: mockPrisma, session: mockSession },
      { projectId: "project-1" },
    );

  describe("when the user has a team grant", () => {
    beforeEach(() => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          roleKey: "member",
          principalType: "USER",
          principalId: "user-rolebinding-only",
        },
      ]);
    });

    it("grants visibility for captured content (platform default)", async () => {
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    it("queries live grants with the project's team scope", async () => {
      await protections();
      expect(mockPrisma.grant.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          scopeType: "TEAM",
          scopeId: "team-1",
          revokedAt: null,
          principalType: { in: ["USER", "GROUP"] },
        },
        select: { roleKey: true, principalType: true, principalId: true },
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

  describe("when the user has an admin team grant", () => {
    beforeEach(() => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          roleKey: "admin",
          principalType: "USER",
          principalId: "user-rolebinding-only",
        },
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

  describe("when the user has no team grant", () => {
    beforeEach(() => {
      mockPrisma.grant.findMany.mockResolvedValue([]);
    });

    it("denies captured content for a non-member", async () => {
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });

    it("does not restore access from an old admin binding", async () => {
      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { userId: "user-rolebinding-only", teamId: "team-1", role: "ADMIN" },
      ]);
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
      expect(mockPrisma.roleBinding.findMany).not.toHaveBeenCalled();
    });

    it("denies admin-only content without an admin grant", async () => {
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: ADMINS },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
    });

    it("does not infer admin access from an organization role", async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        userId: "user-rolebinding-only",
        organizationId: "org-1",
        role: "ADMIN",
      });
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: ADMINS },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
    });

    it("does not restore access from an old team membership", async () => {
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "user-rolebinding-only", teamId: "team-1", role: "MEMBER" },
      ]);
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });
});
