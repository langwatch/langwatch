import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  checkRoleBindingPermission,
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
  } as unknown as Parameters<typeof checkRoleBindingPermission>[0]["prisma"];
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

  describe("when resolving ancestor scopes", () => {
    it("grants access via team-level binding when checking a project scope", async () => {
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
        scope: projectScope,
        permission: "analytics:view",
      });

      expect(result).toBe(true);
    });

    it("unions permissions from all ancestor-scope bindings — higher scope grants access", async () => {
      // VIEWER at project + MEMBER at team → MEMBER permissions apply (union)
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.VIEWER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: PROJECT_ID,
          },
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
        scope: projectScope,
        permission: "datasets:manage",
      });

      // datasets:manage is granted by MEMBER but not VIEWER
      expect(result).toBe(true);
    });

    it("does not grant access from a binding on a different team", async () => {
      const prisma = makePrisma({
        directBindings: [
          {
            role: TeamUserRole.ADMIN,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "other-team",
          },
        ],
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
        permission: "team:manage",
      });

      expect(result).toBe(false);
    });

    it("does not fall back to TeamUser when RoleBindings exist (even if none match the scope)", async () => {
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

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
        permission: "team:manage",
      });

      expect(result).toBe(false);
    });
  });

  describe("when no RoleBindings exist", () => {
    it("returns false — TeamUser fallback is handled by checkPermissionFromBindings, not this resolver", async () => {
      const prisma = makePrisma({
        directBindings: [],
        groupBindings: [],
        teamUser: { role: TeamUserRole.ADMIN, assignedRoleId: null },
      });

      const result = await checkRoleBindingPermission({
        prisma,
        userId: USER_ID,
        organizationId: ORG_ID,
        scope: projectScope,
        permission: "team:manage",
      });

      expect(result).toBe(false);
    });
  });
});
