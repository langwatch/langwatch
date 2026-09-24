import { beforeEach, describe, expect, it, vi } from "vitest";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
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

type ScopedGrant = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
  roleKey: string;
};

/**
 * Seed the ledger with the user's grants and answer `grant.findMany` by the
 * scopes the query actually asks for, so a query that forgets a tier misses
 * the grants held there.
 */
function seedGrants(grants: ScopedGrant[]) {
  mockPrisma.grant.findMany.mockImplementation(
    async ({ where }: { where: any }) => {
      const scopes: Array<{ scopeType: string; scopeId: string }> =
        where.OR ?? [{ scopeType: where.scopeType, scopeId: where.scopeId }];
      return grants
        .filter((grant) =>
          scopes.some(
            (scope) =>
              scope.scopeType === grant.scopeType &&
              scope.scopeId === grant.scopeId,
          ),
        )
        .map((grant) => ({
          roleKey: grant.roleKey,
          principalType: "USER",
          principalId: "user-rolebinding-only",
        }));
    },
  );
}

const ADMINS: Audience = { admins: true };
const NO_ONE: Audience = {};

describe("getUserProtectionsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(probeProjectPermission).mockResolvedValue(true);
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
      seedGrants([{ scopeType: "TEAM", scopeId: "team-1", roleKey: "member" }]);
    });

    it("grants visibility for captured content (platform default)", async () => {
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    it("queries live grants on the project's organization, team and project", async () => {
      await protections();
      expect(mockPrisma.grant.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          OR: [
            { scopeType: "ORGANIZATION", scopeId: "org-1" },
            { scopeType: "TEAM", scopeId: "team-1" },
            { scopeType: "PROJECT", scopeId: "project-1" },
          ],
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
      seedGrants([{ scopeType: "TEAM", scopeId: "team-1", roleKey: "admin" }]);
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

  describe("when the user is an organization admin with no team grant", () => {
    beforeEach(() => {
      seedGrants([
        { scopeType: "ORGANIZATION", scopeId: "org-1", roleKey: "admin" },
      ]);
    });

    /** @scenario "An organization admin with no team role sees captured content" */
    it("shows captured content under the platform default", async () => {
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });

    /** @scenario "An organization admin with no team role is in the Admins audience" */
    it("shows input restricted to admins", async () => {
      mockPolicy(
        policyRestricting({
          input: { disposition: "restrict", audience: ADMINS },
        }),
      );
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
    });
  });

  describe("when the user holds a member role on the project only", () => {
    beforeEach(() => {
      seedGrants([
        { scopeType: "PROJECT", scopeId: "project-1", roleKey: "member" },
      ]);
    });

    /** @scenario "A project-level role counts as project membership" */
    it("shows captured content under the platform default", async () => {
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(true);
      expect(result.canSeeCapturedOutput).toBe(true);
    });
  });

  describe("when the permission engine denies the user trace access", () => {
    beforeEach(() => {
      seedGrants([]);
      vi.mocked(probeProjectPermission).mockImplementation(
        async (_ctx, _projectId, permission) => permission !== "traces:view",
      );
    });

    /** @scenario "Someone the permission engine denies trace access is not a member" */
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

    it("does not restore access from an old team membership", async () => {
      mockPrisma.teamUser.findMany.mockResolvedValue([
        { userId: "user-rolebinding-only", teamId: "team-1", role: "MEMBER" },
      ]);
      const result = await protections();
      expect(result.canSeeCapturedInput).toBe(false);
      expect(result.canSeeCapturedOutput).toBe(false);
    });
  });

  describe("when the user can read traces but holds no role grant", () => {
    beforeEach(() => {
      seedGrants([]);
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

    it("does not infer admin access from the legacy organization role", async () => {
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
  });
});
