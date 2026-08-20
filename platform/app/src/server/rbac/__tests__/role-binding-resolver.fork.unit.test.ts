/**
 * @vitest-environment node
 *
 * ADR-092 delivery-plan PR 3 — the fork at the two API-key seams. As in
 * rbac.fork.unit.test.ts, every case is built so the resolvers cannot agree:
 * the access exists as a Grant head and as no compat `RoleBinding` row, so the
 * answer names which resolver is primary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCutoverGateForTesting } from "~/server/app-layer/authz/cutover-gate";

const { userPermissionCheck, apiKeyPermissionCheck } = vi.hoisted(() => ({
  userPermissionCheck: vi.fn(),
  apiKeyPermissionCheck: vi.fn(),
}));

vi.mock("~/server/app-layer/authz/shadow", () => ({
  authzShadowFor: () => ({
    userPermissionCheck,
    apiKeyPermissionCheck,
    userBatchPermissionCheck: vi.fn(),
  }),
  demoProjectId: () => undefined,
  parseShadowRate: () => 0,
}));

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
}: {
  onEngine: boolean;
  grants: Array<"USER" | "API_KEY">;
}) {
  const grantFindMany = vi.fn(async (args: any) =>
    grants.includes(args?.where?.principalType) ? adminGrantAtProject : [],
  );
  const roleBindingFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    authzCutoverProjection: {
      findUnique: vi.fn().mockResolvedValue({ onEngine }),
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
    grant: { findMany: grantFindMany },
    role: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    prisma: prisma as never,
    grantFindMany,
    roleBindingFindMany,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  resetCutoverGateForTesting();
});

describe("the fork at the api-key seams", () => {
  describe("given a cut-over organization", () => {
    describe("when a named principal is checked", () => {
      it("returns the engine's answer and compares legacy behind it", async () => {
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
        await settle();
        expect(roleBindingFindMany).toHaveBeenCalled();
        expect(userPermissionCheck).not.toHaveBeenCalled();
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
            skipShadow: true,
          });
          await settle();

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
            skipShadow: true,
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
          skipShadow: true,
        });

        expect(permitted).toBe(true);
      });

      describe("when the owner has been downgraded", () => {
        it("denies through the ceiling, though the key's own grant allows", async () => {
          const { prisma } = buildPrisma({
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
            skipShadow: true,
          });

          expect(permitted).toBe(false);
        });
      });

      describe("when the key has no owner", () => {
        it("carries no ceiling", async () => {
          const { prisma } = buildPrisma({
            onEngine: true,
            grants: ["API_KEY"],
          });

          const permitted = await resolveApiKeyPermission({
            prisma,
            apiKeyId: API_KEY_ID,
            userId: null,
            organizationId: ORGANIZATION_ID,
            scope: projectScope,
            permission: "datasets:manage",
            skipShadow: true,
          });

          expect(permitted).toBe(true);
        });
      });
    });
  });

  describe("given an organization that is not cut over", () => {
    describe("when a named principal is checked", () => {
      it("keeps the legacy answer and the stage-A4 shadow", async () => {
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
        expect(userPermissionCheck).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: USER_ID,
            legacyAllowed: false,
            caller: "apiKeyPath.userBindings",
            fromApiKeyPath: true,
          }),
        );
        expect(grantFindMany).not.toHaveBeenCalled();
      });
    });

    describe("when an api key's ceiling is resolved", () => {
      it("keeps the legacy steps and the ceiling shadow", async () => {
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
        expect(apiKeyPermissionCheck).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKeyId: API_KEY_ID,
            ownerUserId: USER_ID,
            legacyAllowed: false,
            caller: "apiKeyPath.ceiling",
          }),
        );
        expect(grantFindMany).not.toHaveBeenCalled();
      });
    });
  });
});
