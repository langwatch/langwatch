/**
 * @vitest-environment node
 *
 * The fork at the two API-key seams: an organization that finished its
 * migration is decided by the engine, one that has not by the legacy walk.
 *
 * Each case pins which resolver answered, mostly by construction — the access
 * exists as a Grant row and as no `RoleBinding` row, so the two cannot agree
 * — and where both would answer alike (the downgraded-owner deny) by
 * asserting the read only the engine issues.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/engine-gate";

import {
  checkRoleBindingPermission,
  resolveApiKeyPermission,
  type ScopeRef,
} from "../role-binding-resolver";

const ORGANIZATION_ID = "organization_fork_2";
const TEAM_ID = "team_fork_2";
const PROJECT_ID = "project_fork_2";
const USER_ID = "user_fork_2";
const API_KEY_ID = "apikey_fork_2";

const projectScope: ScopeRef = {
  type: "project",
  id: PROJECT_ID,
  teamId: TEAM_ID,
};

const adminGrantAtProject = [
  { roleKey: "admin", scopeType: "PROJECT", scopeId: PROJECT_ID },
];

/**
 * `grants` names which principal types hold an org-admin grant on this
 * project; everything else in the world is empty, including every compat
 * binding row.
 */
function buildPrisma({
  onEngine,
  grants,
  keyOwner = USER_ID,
}: {
  onEngine: boolean;
  grants: Array<"USER" | "API_KEY">;
  /** What the DATABASE says the key's owner is. Null is a service key. */
  keyOwner?: string | null;
}) {
  const grantFindMany = vi.fn(async (args: any) =>
    grants.includes(args?.where?.principalType) ? adminGrantAtProject : [],
  );
  const roleBindingFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    systemMigrationTenantState: {
      findUnique: vi
        .fn()
        .mockResolvedValue(onEngine ? { status: "migrated" } : null),
    },
    project: {
      findUnique: vi.fn().mockResolvedValue({
        team: { id: TEAM_ID, organizationId: ORGANIZATION_ID },
      }),
    },
    team: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ role: "MEMBER" }),
    },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    roleBinding: {
      findMany: roleBindingFindMany,
      count: vi.fn().mockResolvedValue(0),
    },
    customRole: { findFirst: vi.fn().mockResolvedValue(null) },
    teamUser: {
      findFirst: vi.fn().mockResolvedValue(null),
      // The grants-head reader consults the same TeamUser rows as the legacy
      // one (the org-level union quirk stays live on both heads until
      // contract); none exist in these fixtures.
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    // The ceiling's subject: the engine resolves the key's owner through the
    // collector rather than taking it from the caller, so every check that
    // applies a ceiling reads this.
    apiKey: {
      findUnique: vi.fn().mockResolvedValue({ userId: keyOwner }),
    },
    grant: { findMany: grantFindMany },
    role: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    prisma: prisma as never,
    grantFindMany,
    roleBindingFindMany,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthzEngineGateForTesting();
});

describe("the fork at the api-key seams", () => {
  describe("given a migrated organization", () => {
    describe("when a named principal is checked", () => {
      it("returns the engine's answer", async () => {
        const { prisma, roleBindingFindMany } = buildPrisma({
          onEngine: true,
          grants: ["USER"],
        });

        const permitted = await checkRoleBindingPermission({
          prisma,
          principal: { type: "user", id: USER_ID },
          organizationId: ORGANIZATION_ID,
          scope: projectScope,
          permission: "datasets:manage",
        });

        expect(permitted).toBe(true);
        // The engine answered alone: nothing runs the legacy walk behind it.
        expect(roleBindingFindMany).not.toHaveBeenCalled();
        });

      describe("when the caller silences the comparison", () => {
        it("still decides on the engine, and never runs legacy", async () => {
          const { prisma, roleBindingFindMany } = buildPrisma({
            onEngine: true,
            grants: ["USER"],
          });

          const permitted = await checkRoleBindingPermission({
            prisma,
            principal: { type: "user", id: USER_ID },
            organizationId: ORGANIZATION_ID,
            scope: projectScope,
            permission: "datasets:manage",
          });

          expect(permitted).toBe(true);
          expect(roleBindingFindMany).not.toHaveBeenCalled();
        });
      });

      describe("when the principal is an api key", () => {
        it("answers on the key's own grants, with no owner ceiling", async () => {
          const { prisma } = buildPrisma({
            onEngine: true,
            grants: ["API_KEY"],
          });

          const permitted = await checkRoleBindingPermission({
            prisma,
            principal: { type: "apiKey", id: API_KEY_ID },
            organizationId: ORGANIZATION_ID,
            scope: projectScope,
            permission: "datasets:manage",
          });

          expect(permitted).toBe(true);
        });
      });
    });

    describe("when an api key's ceiling is resolved", () => {
      it("allows only where the owner holds the permission too", async () => {
        const { prisma } = buildPrisma({
          onEngine: true,
          grants: ["API_KEY", "USER"],
        });

        const permitted = await resolveApiKeyPermission({
          prisma,
          apiKeyId: API_KEY_ID,
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          scope: projectScope,
          permission: "datasets:manage",
        });

        expect(permitted).toBe(true);
      });

      describe("when the owner has been downgraded", () => {
        it("denies through the ceiling, though the key's own grant allows", async () => {
          const { prisma, grantFindMany } = buildPrisma({
            onEngine: true,
            grants: ["API_KEY"],
          });

          const permitted = await resolveApiKeyPermission({
            prisma,
            apiKeyId: API_KEY_ID,
            userId: USER_ID,
            organizationId: ORGANIZATION_ID,
            scope: projectScope,
            permission: "datasets:manage",
          });

          expect(permitted).toBe(false);
          // Legacy would deny this fixture too (no binding rows exist), so
          // the deny alone cannot tell the resolvers apart. What can: the
          // ENGINE's ceiling is a USER-principal read of the grant head,
          // which the legacy resolver never issues.
          expect(grantFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ principalType: "USER" }),
            }),
          );
        });
      });

      describe("when the key has no owner", () => {
        it("carries no ceiling", async () => {
          const { prisma } = buildPrisma({
            onEngine: true,
            grants: ["API_KEY"],
            keyOwner: null,
          });

          const permitted = await resolveApiKeyPermission({
            prisma,
            apiKeyId: API_KEY_ID,
            userId: null,
            organizationId: ORGANIZATION_ID,
            scope: projectScope,
            permission: "datasets:manage",
          });

          expect(permitted).toBe(true);
        });
      });

      describe("when the caller claims the key has no owner but it does", () => {
        /**
         * The ceiling is resolved from the database, never from what the
         * caller says. Taking `userId` on trust would let any caller shed an
         * owner ceiling by passing null — the key's own grant would then
         * answer alone, which is the whole thing the ceiling exists to stop.
         *
         * @scenario "An api key's ceiling cannot be dropped by its caller"
         */
        it("applies the ceiling anyway", async () => {
          const { prisma } = buildPrisma({
            onEngine: true,
            grants: ["API_KEY"],
            keyOwner: USER_ID,
          });

          const permitted = await resolveApiKeyPermission({
            prisma,
            apiKeyId: API_KEY_ID,
            userId: null,
            organizationId: ORGANIZATION_ID,
            scope: projectScope,
            permission: "datasets:manage",
          });

          expect(permitted).toBe(false);
        });
      });
    });
  });

  describe("given an organization still on the legacy path", () => {
    describe("when a named principal is checked", () => {
      it("keeps the legacy answer and never reads a grant", async () => {
        const { prisma, grantFindMany } = buildPrisma({
          onEngine: false,
          grants: ["USER"],
        });

        const permitted = await checkRoleBindingPermission({
          prisma,
          principal: { type: "user", id: USER_ID },
          organizationId: ORGANIZATION_ID,
          scope: projectScope,
          permission: "datasets:manage",
        });

        expect(permitted).toBe(false);
        expect(grantFindMany).not.toHaveBeenCalled();
      });
    });

    describe("when an api key's ceiling is resolved", () => {
      it("keeps the legacy steps and never reads a grant", async () => {
        const { prisma, grantFindMany } = buildPrisma({
          onEngine: false,
          grants: ["API_KEY", "USER"],
        });

        const permitted = await resolveApiKeyPermission({
          prisma,
          apiKeyId: API_KEY_ID,
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          scope: projectScope,
          permission: "datasets:manage",
        });

        expect(permitted).toBe(false);
        expect(grantFindMany).not.toHaveBeenCalled();
      });
    });
  });
});
