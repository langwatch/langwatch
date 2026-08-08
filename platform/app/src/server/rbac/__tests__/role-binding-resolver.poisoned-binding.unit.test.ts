import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  checkRoleBindingPermission,
  type ScopeRef,
} from "../role-binding-resolver";

const ORG_ID = "org_a";
const OTHER_ORG_ID = "org_b";
const TEAM_ID = "team_a";
const USER_ID = "user_1";
const API_KEY_ID = "apikey_1";

const teamScope: ScopeRef = { type: "team", id: TEAM_ID };

type StoredCustomRole = {
  id: string;
  organizationId: string;
  kind: string;
  permissions: string[];
};

type StoredBinding = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

/**
 * The custom-role store honors whatever `where` clause the resolver sends, so
 * the outcome tracks the QUERY rather than the mock: an id-only lookup finds a
 * poisoned role from another organization, an organization- and kind-scoped
 * lookup does not. That is exactly the defense-in-depth line under test.
 */
const kindMatches = (
  roleKind: string,
  kind: string | { not?: string } | undefined,
): boolean => {
  if (kind === undefined) return true;
  if (typeof kind === "string") return roleKind === kind;
  return kind.not === undefined || roleKind !== kind.not;
};

const fieldMatches = (roleValue: string, whereValue: unknown): boolean =>
  whereValue === undefined || roleValue === whereValue;

function makePrisma({
  bindings,
  customRoles,
}: {
  bindings: StoredBinding[];
  customRoles: StoredCustomRole[];
}) {
  const matches = (
    role: StoredCustomRole,
    where: Record<string, unknown>,
  ): boolean =>
    fieldMatches(role.id, where.id) &&
    fieldMatches(role.organizationId, where.organizationId) &&
    kindMatches(role.kind, where.kind as string | { not?: string } | undefined);

  const lookup = async ({ where }: { where: Record<string, unknown> }) => {
    const found = customRoles.find((role) => matches(role, where));
    return found ? { permissions: found.permissions } : null;
  };

  return {
    roleBinding: {
      // First call answers direct bindings (or the API key's bindings);
      // the second call answers group-derived bindings for user principals.
      findMany: vi
        .fn()
        .mockImplementationOnce(async () => bindings)
        .mockImplementationOnce(async () => [])
        // A floor under the two scripted calls: a resolver that reads a third
        // time must fail on the assertion, not on dereferencing undefined.
        .mockImplementation(async () => []),
    },
    teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
    customRole: {
      findFirst: vi.fn().mockImplementation(lookup),
    },
  } as unknown as Parameters<typeof checkRoleBindingPermission>[0]["prisma"];
}

const customBinding = (customRoleId: string): StoredBinding => ({
  role: TeamUserRole.CUSTOM,
  customRoleId,
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: TEAM_ID,
});

describe("checkRoleBindingPermission, given a poisoned custom-role binding", () => {
  describe("when the binding points at a role from another organization", () => {
    /** @scenario A poisoned cross-organization binding does not grant access */
    it("denies the permission the foreign role would grant", async () => {
      const prisma = makePrisma({
        bindings: [customBinding("role_foreign")],
        customRoles: [
          {
            id: "role_foreign",
            organizationId: OTHER_ORG_ID,
            kind: "custom",
            permissions: ["project:manage"],
          },
        ],
      });

      await expect(
        checkRoleBindingPermission({
          prisma,
          userId: USER_ID,
          organizationId: ORG_ID,
          scope: teamScope,
          permission: "project:manage",
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when a user's binding points at an API key's system role", () => {
    it("denies the permission the system role carries", async () => {
      const prisma = makePrisma({
        bindings: [customBinding("role_system")],
        customRoles: [
          {
            id: "role_system",
            organizationId: ORG_ID,
            kind: "system_api_key",
            permissions: ["project:manage"],
          },
        ],
      });

      await expect(
        checkRoleBindingPermission({
          prisma,
          userId: USER_ID,
          organizationId: ORG_ID,
          scope: teamScope,
          permission: "project:manage",
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when an API key's own binding points at its system role", () => {
    it("still grants the system role's permissions", async () => {
      const prisma = makePrisma({
        bindings: [customBinding("role_system")],
        customRoles: [
          {
            id: "role_system",
            organizationId: ORG_ID,
            kind: "system_api_key",
            permissions: ["project:view"],
          },
        ],
      });

      await expect(
        checkRoleBindingPermission({
          prisma,
          principal: { type: "apiKey", id: API_KEY_ID },
          organizationId: ORG_ID,
          scope: teamScope,
          permission: "project:view",
        }),
      ).resolves.toBe(true);
    });
  });

  describe("when the binding points at a same-organization custom role", () => {
    it("still grants the role's permissions", async () => {
      const prisma = makePrisma({
        bindings: [customBinding("role_local")],
        customRoles: [
          {
            id: "role_local",
            organizationId: ORG_ID,
            kind: "custom",
            permissions: ["project:manage"],
          },
        ],
      });

      await expect(
        checkRoleBindingPermission({
          prisma,
          userId: USER_ID,
          organizationId: ORG_ID,
          scope: teamScope,
          permission: "project:manage",
        }),
      ).resolves.toBe(true);
    });
  });
});
