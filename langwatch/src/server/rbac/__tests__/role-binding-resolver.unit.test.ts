import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  checkRoleBindingPermission,
  resolveEffectiveRole,
  type ScopeRef,
} from "../role-binding-resolver";

// ============================================================================
// Prisma mock factory
// ============================================================================

type RoleBindingRecord = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

type TeamUserRecord = {
  role: TeamUserRole;
  assignedRoleId: string | null;
};

function makePrisma({
  directBindings = [] as RoleBindingRecord[],
  groupBindings = [] as RoleBindingRecord[],
  teamUser = null as TeamUserRecord | null,
  customRolePermissions = null as string[] | null,
} = {}) {
  return {
    roleBinding: {
      findMany: vi
        .fn()
        .mockImplementationOnce(async () => directBindings)
        .mockImplementationOnce(async () => groupBindings),
    },
    teamUser: {
      findFirst: vi.fn().mockResolvedValue(teamUser),
    },
    customRole: {
      findUnique: vi.fn().mockResolvedValue(
        customRolePermissions !== null
          ? { permissions: customRolePermissions }
          : null,
      ),
    },
  } as unknown as Parameters<typeof resolveEffectiveRole>[0]["prisma"];
}

const ORG_ID = "org1";
const USER_ID = "user1";
const TEAM_ID = "team1";
const PROJECT_ID = "proj1";

const teamScope: ScopeRef = { type: "team", id: TEAM_ID };
const projectScope: ScopeRef = {
  type: "project",
  id: PROJECT_ID,
  teamId: TEAM_ID,
};
const orgScope: ScopeRef = { type: "org", id: ORG_ID };

// ============================================================================
// resolveEffectiveRole — scope resolution
// ============================================================================

describe("resolveEffectiveRole()", () => {
  describe("when resolving scope hierarchy", () => {
    it("returns team-level role for a project when only team binding exists", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result).toEqual({
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        fromFallback: false,
      });
    });

    it("returns project-level role when project binding overrides team binding", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
          {
            role: TeamUserRole.VIEWER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: PROJECT_ID,
          },
        ],
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result?.role).toBe(TeamUserRole.VIEWER);
    });

    it("returns ADMIN for org-level ADMIN binding regardless of scope", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.ADMIN,
            customRoleId: null,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: ORG_ID,
          },
        ],
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result?.role).toBe(TeamUserRole.ADMIN);
    });

    it("returns null when no binding matches the target team", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "other-team",
          },
        ],
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result).toBeNull();
    });

    it("returns null when user has no bindings and no TeamUser fallback", async () => {
      const prisma = makePrisma({ directBindings: [], teamUser: null });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result).toBeNull();
    });
  });

  describe("when resolving multiple bindings at the same scope", () => {
    it("picks the highest role when multiple group bindings exist at the same scope", async () => {
      const prisma = makePrisma({
        groupBindings: [
          {
            role: TeamUserRole.VIEWER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
      });

      expect(result?.role).toBe(TeamUserRole.MEMBER);
    });

    it("picks the highest role across direct and group bindings at the same scope", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.VIEWER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
        groupBindings: [
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
      });

      expect(result?.role).toBe(TeamUserRole.MEMBER);
    });
  });

  describe("when a group binding at project scope overrides a team-level binding", () => {
    it("resolves to the project-level binding (most specific wins)", async () => {
      const prisma = makePrisma({
        groupBindings: [
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
          {
            role: TeamUserRole.VIEWER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: PROJECT_ID,
          },
        ],
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result?.role).toBe(TeamUserRole.VIEWER);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy fallback
  // ──────────────────────────────────────────────────────────────────────────

  describe("when falling back to TeamUser", () => {
    it("uses TeamUser record when no RoleBindings exist", async () => {
      const prisma = makePrisma({
        directBindings: [],
        groupBindings: [],
        teamUser: { role: TeamUserRole.MEMBER, assignedRoleId: null },
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result).toEqual({
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        fromFallback: true,
      });
    });

    it("does not fall back when RoleBindings exist (even if none match the scope)", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "other-team",
          },
        ],
        teamUser: { role: TeamUserRole.ADMIN, assignedRoleId: null },
      });

      const result = await resolveEffectiveRole({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
      });

      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// checkRoleBindingPermission — permission mapping
// ============================================================================

describe("checkRoleBindingPermission()", () => {
  describe("when checking built-in role permissions", () => {
    it("grants team:manage to Admin", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.ADMIN,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
        permission: "team:manage",
      });

      expect(result).toBe(true);
    });

    it("denies team:manage to Member", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
        permission: "team:manage",
      });

      expect(result).toBe(false);
    });

    it("grants analytics:view to Viewer", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.VIEWER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
        permission: "analytics:view",
      });

      expect(result).toBe(true);
    });

    it("denies datasets:manage to Viewer", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.VIEWER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
        permission: "datasets:manage",
      });

      expect(result).toBe(false);
    });
  });

  describe("when checking custom role permissions", () => {
    it("uses custom role permissions when CUSTOM role is resolved", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.CUSTOM,
            customRoleId: "cr1",
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
        customRolePermissions: ["datasets:manage", "analytics:view"],
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
        permission: "datasets:manage",
      });

      expect(result).toBe(true);
    });

    it("denies permissions not in the custom role", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.CUSTOM,
            customRoleId: "cr1",
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: TEAM_ID,
          },
        ],
        customRolePermissions: ["analytics:view"],
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
        permission: "datasets:manage",
      });

      expect(result).toBe(false);
    });
  });

  describe("when user has no access", () => {
    it("returns false", async () => {
      const prisma = makePrisma({ directBindings: [], teamUser: null });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: teamScope,
        permission: "analytics:view",
      });

      expect(result).toBe(false);
    });
  });
});
