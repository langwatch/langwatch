import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { teamRouter } from "../team";
import { createInnerTRPCContext } from "../../trpc";

// Team membership is written ONLY to RoleBinding since migration
// 20260407120000_migrate_team_users_to_role_bindings — the legacy TeamUser
// relation is no longer populated for members added through the settings page.
// These regression guards prove the read paths (getTeamWithMembers,
// getTeamsWithMembers, getBySlug) resolve membership from TEAM-scoped
// RoleBindings rather than the stale team.members (TeamUser) relation.
// Without this, a freshly-added admin vanishes on refresh, disappears from
// member pickers, and fails the getBySlug access gate.
//
// The org-permission middleware/guard is real authorization the page already
// passes for an org admin; it's mocked to a pass-through so these tests isolate
// the member-resolution read path.
vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkOrganizationPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    hasOrganizationPermission: vi.fn().mockResolvedValue(true),
  };
});

const ORG_ID = "org_1";
const TEAM_ID = "team_1";
const TEAM_SLUG = "acme-team";
const CALLER_ID = "caller_admin";
const MEMBER_ID = "member_rolebinding_only";

function team() {
  return {
    id: TEAM_ID,
    slug: TEAM_SLUG,
    name: "Acme Team",
    organizationId: ORG_ID,
    isPersonal: false,
    ownerUserId: null,
    projects: [],
  };
}

function buildMockPrisma({
  teamBindings,
}: {
  teamBindings: unknown[];
}): PrismaClient {
  return {
    team: {
      // No `members` (TeamUser) rows — mirrors a team whose membership was
      // written post-migration as RoleBindings only.
      findFirst: vi.fn().mockResolvedValue(team()),
      findMany: vi.fn().mockResolvedValue([team()]),
    },
    roleBinding: {
      findMany: vi.fn().mockResolvedValue(teamBindings),
    },
  } as unknown as PrismaClient;
}

function buildCaller(prisma: PrismaClient) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: CALLER_ID }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = prisma;
  return teamRouter.createCaller(ctx);
}

function bindingFor({
  userId,
  role = TeamUserRole.ADMIN,
}: {
  userId: string;
  role?: TeamUserRole;
}) {
  return {
    id: `rb_${userId}_${role}`,
    userId,
    role,
    customRoleId: null,
    customRole: null,
    scopeType: RoleBindingScopeType.TEAM,
    scopeId: TEAM_ID,
    organizationId: ORG_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    user: {
      id: userId,
      name: "New Admin",
      email: `${userId}@example.com`,
    },
  };
}

describe("team.getTeamWithMembers", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when a member exists only as a TEAM-scoped RoleBinding (no legacy TeamUser row)", () => {
    it("includes the RoleBinding-only member in the returned members", async () => {
      const caller = buildCaller(
        buildMockPrisma({ teamBindings: [bindingFor({ userId: MEMBER_ID })] }),
      );

      const result = await caller.getTeamWithMembers({
        slug: TEAM_SLUG,
        organizationId: ORG_ID,
      });

      const member = result.members.find((m) => m.user.id === MEMBER_ID);
      expect(member).toBeDefined();
      expect(member!.role).toBe(TeamUserRole.ADMIN);
      expect(member!.user.email).toBe(`${MEMBER_ID}@example.com`);
    });
  });

  describe("when a user holds multiple TEAM bindings on the same team", () => {
    it("returns one member row with the highest-privilege role", async () => {
      // The partial unique indexes allow a user to have both a MEMBER and an
      // ADMIN binding at the same scope — they must not become two form rows.
      const caller = buildCaller(
        buildMockPrisma({
          teamBindings: [
            bindingFor({ userId: MEMBER_ID, role: TeamUserRole.MEMBER }),
            bindingFor({ userId: MEMBER_ID, role: TeamUserRole.ADMIN }),
          ],
        }),
      );

      const result = await caller.getTeamWithMembers({
        slug: TEAM_SLUG,
        organizationId: ORG_ID,
      });

      const rows = result.members.filter((m) => m.user.id === MEMBER_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.role).toBe(TeamUserRole.ADMIN);
    });
  });

  describe("when the team has no TEAM-scoped role bindings", () => {
    it("returns no members", async () => {
      const caller = buildCaller(buildMockPrisma({ teamBindings: [] }));

      const result = await caller.getTeamWithMembers({
        slug: TEAM_SLUG,
        organizationId: ORG_ID,
      });

      expect(result.members).toEqual([]);
    });
  });
});

describe("team.getTeamsWithMembers", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when a member exists only as a TEAM-scoped RoleBinding (no legacy TeamUser row)", () => {
    it("includes the RoleBinding-only member in the team's members", async () => {
      const caller = buildCaller(
        buildMockPrisma({ teamBindings: [bindingFor({ userId: MEMBER_ID })] }),
      );

      const teams = await caller.getTeamsWithMembers({ organizationId: ORG_ID });

      const found = teams.find((t) => t.id === TEAM_ID);
      expect(found).toBeDefined();
      expect(found!.members.some((m) => m.user.id === MEMBER_ID)).toBe(true);
    });
  });
});

describe("team.getBySlug", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the caller is a member only via a TEAM-scoped RoleBinding", () => {
    it("returns the team (access gate honors RoleBindings, not TeamUser)", async () => {
      const caller = buildCaller(
        buildMockPrisma({ teamBindings: [bindingFor({ userId: CALLER_ID })] }),
      );

      const result = await caller.getBySlug({
        slug: TEAM_SLUG,
        organizationId: ORG_ID,
      });

      expect(result?.id).toBe(TEAM_ID);
    });
  });

  describe("when the caller has no binding to the team", () => {
    it("returns null", async () => {
      const caller = buildCaller(
        buildMockPrisma({ teamBindings: [bindingFor({ userId: MEMBER_ID })] }),
      );

      const result = await caller.getBySlug({
        slug: TEAM_SLUG,
        organizationId: ORG_ID,
      });

      expect(result).toBeNull();
    });
  });
});
