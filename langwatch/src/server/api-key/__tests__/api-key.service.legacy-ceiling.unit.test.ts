import { TeamUserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The legacy-membership half of the API-key ceiling.
 *
 * `checkRoleBindingPermission` reports RoleBindings and nothing else, on
 * purpose — its own suite pins that ("TeamUser fallback is handled by
 * checkPermissionFromBindings, not this resolver"). The tRPC authorization
 * path layers the legacy TeamUser fallback on top of it. This ceiling never
 * did, and the asymmetry was reachable: a user whose access came from legacy
 * membership passed every authorization check, was measured by
 * `batchProjectPermissions` as holding permissions, then was refused those
 * same permissions here as "exceeds your own access".
 *
 * Langy mints a per-turn key mirroring the caller's permissions, so on a
 * workspace still on legacy membership every turn died with an opaque
 * `api_key_scope_violation`.
 *
 * @see specs/api-keys/scope-based-permissions.feature
 */

const ORG_ID = "org1";
const USER_ID = "user1";
const TEAM_ID = "team1";
const PROJECT_ID = "proj1";

// No RoleBindings anywhere — the exact condition the fallback exists for.
const mockCheckPermission = vi.fn().mockResolvedValue(false);
vi.mock("~/server/rbac/role-binding-resolver", () => ({
  checkRoleBindingPermission: (...args: unknown[]) =>
    mockCheckPermission(...args),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock("../api-key-token.utils", () => ({
  generateApiKeyToken: () => ({
    token: "sk-lw-test",
    lookupId: "lookup",
    hashedSecret: "hash",
  }),
  hashSecret: vi.fn(),
  verifySecret: vi.fn(),
  splitApiKeyToken: vi.fn(),
  INGEST_KEY_PREFIX: "ik-lw-",
}));

const forceTeamRoleGrantsEverything = vi.fn();
vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    // Real `bindingScopeCanGrant` — that is the code under test.
    teamRoleHasPermission: (...args: unknown[]) =>
      forceTeamRoleGrantsEverything.mock.calls.length ||
      forceTeamRoleGrantsEverything.getMockImplementation()
        ? forceTeamRoleGrantsEverything(...args)
        : (actual.teamRoleHasPermission as (...a: unknown[]) => boolean)(...args),
  };
});

const { ApiKeyService } = await import("../api-key.service");

function makePrisma({
  roleBindingCount = 0,
  legacyTeamUser = null as { role: TeamUserRole } | null,
} = {}) {
  const projectWithTeam = {
    id: PROJECT_ID,
    teamId: TEAM_ID,
    team: { id: TEAM_ID, organizationId: ORG_ID },
  };
  const roleBindingCountFn = vi.fn().mockResolvedValue(roleBindingCount);
  const teamUserFindFirst = vi.fn().mockResolvedValue(legacyTeamUser);
  const tx = {
    apiKey: {
      create: vi.fn().mockResolvedValue({ id: "ak_1", name: "k" }),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    roleBinding: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn(),
      count: roleBindingCountFn,
    },
    customRole: {
      create: vi.fn().mockResolvedValue({ id: "cr_1" }),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn(),
    },
    teamUser: { findFirst: teamUserFindFirst },
  };

  return {
    prisma: {
      $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      organizationUser: {
        findFirst: vi.fn().mockResolvedValue({ userId: USER_ID }),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue(projectWithTeam),
        findUnique: vi.fn().mockResolvedValue(projectWithTeam),
      },
      team: {
        findFirst: vi.fn().mockResolvedValue({ id: TEAM_ID, organizationId: ORG_ID }),
        findUnique: vi.fn().mockResolvedValue({ id: TEAM_ID, organizationId: ORG_ID }),
      },
      roleBinding: { count: roleBindingCountFn, findMany: vi.fn().mockResolvedValue([]) },
      teamUser: { findFirst: teamUserFindFirst },
      apiKey: { findMany: vi.fn().mockResolvedValue([]) },
    } as any,
    teamUserFindFirst,
  };
}

const createRestrictedKey = (prisma: any) =>
  ApiKeyService.create(prisma).create({
    name: "Langy session",
    isSystemManaged: true,
    userId: USER_ID,
    createdByUserId: USER_ID,
    organizationId: ORG_ID,
    permissionMode: "restricted",
    permissions: ["traces:view"],
    bindings: [
      { role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID } as any,
    ],
  });

beforeEach(() => {
  mockCheckPermission.mockClear();
  mockCheckPermission.mockResolvedValue(false);
  forceTeamRoleGrantsEverything.mockReset();
});

describe("ApiKeyService.create() — ceiling for legacy-membership users", () => {
  describe("given the owner holds no RoleBindings but has a legacy TeamUser role", () => {
    it("mints the key from that legacy role", async () => {
      const { prisma } = makePrisma({
        roleBindingCount: 0,
        legacyTeamUser: { role: TeamUserRole.MEMBER },
      });

      await expect(createRestrictedKey(prisma)).resolves.toMatchObject({
        token: "sk-lw-test",
      });
    });

    it("still refuses a permission that legacy role does not grant", async () => {
      const { prisma } = makePrisma({
        roleBindingCount: 0,
        // VIEWER is read-only; the fallback must not hand out more than the
        // role it stands in for.
        legacyTeamUser: { role: TeamUserRole.VIEWER },
      });

      await expect(
        ApiKeyService.create(prisma).create({
          name: "Langy session",
          isSystemManaged: true,
          userId: USER_ID,
          createdByUserId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["traces:create"],
          bindings: [
            { role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID } as any,
          ],
        }),
      ).rejects.toThrow(/exceeds your own access/);
    });
  });

  describe("given the owner has been migrated to RoleBindings", () => {
    it("does not consult the legacy row at all", async () => {
      const { prisma, teamUserFindFirst } = makePrisma({
        roleBindingCount: 3,
        legacyTeamUser: { role: TeamUserRole.ADMIN },
      });

      // Bindings exist, and the resolver denies — a stale legacy ADMIN row
      // must not rescue it.
      await expect(createRestrictedKey(prisma)).rejects.toThrow(
        /exceeds your own access/,
      );
      expect(teamUserFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("given an org-exclusive permission and only a legacy TEAM role", () => {
    // ADR-021: a team/project-scoped grant never confers an org-exclusive
    // permission. rbac.ts enforces this on legacy roles inside `bindingGrants`;
    // the ceiling has to match, or it accepts what the tRPC path refuses.
    //
    // `teamRoleHasPermission` is forced to true here ON PURPOSE. No team role
    // lists an org-exclusive resource today, so asserting against the real
    // table would pass whether or not the scope guard exists — a test that
    // proves nothing. Forcing the role table to say "yes" isolates the only
    // thing under test: that scope still says "no".
    it("refuses it even when the role table would allow it", async () => {
      const { prisma } = makePrisma({
        roleBindingCount: 0,
        legacyTeamUser: { role: TeamUserRole.ADMIN },
      });
      forceTeamRoleGrantsEverything.mockReturnValue(true);

      await expect(
        ApiKeyService.create(prisma).create({
          name: "Langy session",
          isSystemManaged: true,
          userId: USER_ID,
          createdByUserId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["organization:manage"],
          bindings: [
            { role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID } as any,
          ],
        }),
      ).rejects.toThrow(/exceeds your own access/);
    });

    it("still allows a team-grantable permission on the same path", async () => {
      // The mirror case, so the test above cannot pass by refusing everything.
      const { prisma } = makePrisma({
        roleBindingCount: 0,
        legacyTeamUser: { role: TeamUserRole.ADMIN },
      });
      forceTeamRoleGrantsEverything.mockReturnValue(true);

      await expect(createRestrictedKey(prisma)).resolves.toMatchObject({
        token: "sk-lw-test",
      });
    });
  });

  describe("given the owner has neither bindings nor a legacy row", () => {
    it("refuses", async () => {
      const { prisma } = makePrisma({
        roleBindingCount: 0,
        legacyTeamUser: null,
      });

      await expect(createRestrictedKey(prisma)).rejects.toThrow(
        /exceeds your own access/,
      );
    });
  });
});
