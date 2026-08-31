import { describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { Session } from "~/server/auth";
import { appPermissionsService } from "~/test-utils/appPermissionsMock";
import { batchProjectPermissions, resolveTeamPermission } from "../rbac";

const ORG_ID = "org_a";
const OTHER_ORG_ID = "org_b";
const TEAM_ID = "team_a";
const PROJECT_ID = "project_a";
const USER_ID = "user_1";

type StoredCustomRole = {
  id: string;
  organizationId: string;
  kind: string;
  permissions: string[];
};

type MockPrisma = Parameters<typeof resolveTeamPermission>[0]["prisma"];

type StoredBinding = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

/**
 * The custom-role store honors whatever `where` clause the checker sends, so
 * the outcome tracks the QUERY rather than the mock: an id-only lookup finds a
 * poisoned role from another organization, an organization- and kind-scoped
 * lookup does not. Same line as role-binding-resolver.poisoned-binding, pinned
 * here for the session-user paths (per-call and batched).
 */
const kindMatches = ({
  roleKind,
  kind,
}: {
  roleKind: string;
  kind: string | { not?: string } | undefined;
}): boolean => {
  if (kind === undefined) return true;
  if (typeof kind === "string") return roleKind === kind;
  return kind.not === undefined || roleKind !== kind.not;
};

const fieldMatches = ({
  roleValue,
  whereValue,
}: {
  roleValue: string;
  whereValue: unknown;
}): boolean => whereValue === undefined || roleValue === whereValue;

const idMatches = ({ roleId, whereId }: { roleId: string; whereId: unknown }): boolean => {
  if (whereId === undefined) return true;
  if (typeof whereId === "string") return roleId === whereId;
  const inList = (whereId as { in?: string[] }).in;
  return inList === undefined || inList.includes(roleId);
};

function makePrisma({
  bindings,
  customRoles,
}: {
  bindings: StoredBinding[];
  customRoles: StoredCustomRole[];
}) {
  const matches = ({
    role,
    where,
  }: {
    role: StoredCustomRole;
    where: Record<string, unknown>;
  }): boolean =>
    idMatches({ roleId: role.id, whereId: where.id }) &&
    fieldMatches({
      roleValue: role.organizationId,
      whereValue: where.organizationId,
    }) &&
    kindMatches({
      roleKind: role.kind,
      kind: where.kind as string | { not?: string } | undefined,
    });

  return {
    team: {
      findUnique: vi.fn().mockResolvedValue({ organizationId: ORG_ID }),
    },
    organizationUser: {
      // `disabledAt` is load-bearing: since #7476 a row arriving without the
      // column reads as a disabled seat, and a disabled seat is refused ahead
      // of every binding. Omitting it denied all five cases on membership —
      // which is also why the three that expect a refusal were passing without
      // the poisoned binding being consulted at all.
      findFirst: vi.fn().mockResolvedValue({ role: OrganizationUserRole.MEMBER, disabledAt: null }),
    },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    roleBinding: { findMany: vi.fn().mockResolvedValue(bindings) },
    teamUser: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // No migration row: this organization has not cut over, so the legacy
    // binding walk these cases are about is the one that answers.
    systemMigrationTenantState: { findUnique: vi.fn().mockResolvedValue(null) },
    customRole: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = customRoles.find((role) => matches({ role, where }));
        return found ? { ...found } : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = customRoles.find((role) => matches({ role, where }));
        return found ? { ...found } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        customRoles
          .filter((role) => matches({ role, where }))
          .map((role) => ({ id: role.id, permissions: role.permissions })),
      ),
    },
  } as unknown as MockPrisma;
}

const session = { user: { id: USER_ID } } as unknown as Session;

/**
 * The context the resolvers take. `permissionsFor` reads the ADR-110 fork gate
 * off `ctx.app.permissions` and falls back to `getApp()` when the context
 * carries none — in a unit worker, where no app is initialized, that fallback
 * throws before the binding walk. Built per call so the gate's
 * per-organization cache cannot carry one case's answer into the next.
 */
const context = (prisma: MockPrisma) => ({
  prisma,
  session,
  app: { permissions: appPermissionsService(prisma) },
});

const customBinding = ({
  customRoleId,
  scope,
}: {
  customRoleId: string;
  scope: { scopeType: RoleBindingScopeType; scopeId: string };
}): StoredBinding => ({
  role: TeamUserRole.CUSTOM,
  customRoleId,
  ...scope,
});

const teamScope = {
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: TEAM_ID,
};
const projectScope = {
  scopeType: RoleBindingScopeType.PROJECT,
  scopeId: PROJECT_ID,
};

describe("session-user permission paths, given a poisoned custom-role binding", () => {
  describe("when the per-call path meets a binding naming another organization's role", () => {
    it("denies the permission the foreign role would grant", async () => {
      const prisma = makePrisma({
        bindings: [customBinding({ customRoleId: "role_foreign", scope: teamScope })],
        customRoles: [
          {
            id: "role_foreign",
            organizationId: OTHER_ORG_ID,
            kind: "custom",
            permissions: ["project:manage"],
          },
        ],
      });

      const result = await resolveTeamPermission(context(prisma), TEAM_ID, "project:manage");
      expect(result.permitted).toBe(false);
    });
  });

  describe("when the per-call path meets a binding naming an API key's system role", () => {
    it("denies the permission the system role carries", async () => {
      const prisma = makePrisma({
        bindings: [customBinding({ customRoleId: "role_system", scope: teamScope })],
        customRoles: [
          {
            id: "role_system",
            organizationId: ORG_ID,
            kind: "system_api_key",
            permissions: ["project:manage"],
          },
        ],
      });

      const result = await resolveTeamPermission(context(prisma), TEAM_ID, "project:manage");
      expect(result.permitted).toBe(false);
    });
  });

  describe("when the per-call path meets a same-organization custom role", () => {
    it("still grants the role's permissions", async () => {
      const prisma = makePrisma({
        bindings: [customBinding({ customRoleId: "role_local", scope: teamScope })],
        customRoles: [
          {
            id: "role_local",
            organizationId: ORG_ID,
            kind: "custom",
            permissions: ["project:manage"],
          },
        ],
      });

      const result = await resolveTeamPermission(context(prisma), TEAM_ID, "project:manage");
      expect(result.permitted).toBe(true);
    });
  });

  describe("when the batched path loads a binding naming another organization's role", () => {
    it("denies the permission the foreign role would grant", async () => {
      const prisma = makePrisma({
        bindings: [customBinding({ customRoleId: "role_foreign", scope: projectScope })],
        customRoles: [
          {
            id: "role_foreign",
            organizationId: OTHER_ORG_ID,
            kind: "custom",
            permissions: ["project:manage"],
          },
        ],
      });

      const held = await batchProjectPermissions(context(prisma), {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        permissions: ["project:manage"],
      });
      expect(held).toEqual([]);
    });
  });

  describe("when the batched path loads a same-organization custom role", () => {
    it("still grants the role's permissions", async () => {
      const prisma = makePrisma({
        bindings: [customBinding({ customRoleId: "role_local", scope: projectScope })],
        customRoles: [
          {
            id: "role_local",
            organizationId: ORG_ID,
            kind: "custom",
            permissions: ["project:manage"],
          },
        ],
      });

      const held = await batchProjectPermissions(context(prisma), {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        permissions: ["project:manage"],
      });
      expect(held).toEqual(["project:manage"]);
    });
  });
});
