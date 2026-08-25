import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { apiKeyRouter } from "../apiKey";

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(() => () => "mock48characterrandomstringforapikeygeneration"),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/server/rbac/role-binding-resolver", () => ({
  checkRoleBindingPermission: vi.fn().mockResolvedValue(true),
  // These cases are about the binding path; the legacy fallback grants
  // nothing so the binding decision is the only one under test.
  resolveLegacyCeiling: vi.fn().mockResolvedValue({ grants: () => false }),
}));

vi.mock("~/server/rbac/custom-role-permissions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/rbac/custom-role-permissions")>();
  return {
    ...actual,
    parseCustomRolePermissions: vi
      .fn()
      .mockImplementation(actual.parseCustomRolePermissions),
  };
});

// A key's grants and its private role are ledger commands (ADR-092
// delivery-plan PR 2), so the writer is the seam these cases observe.
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ authzGrants: ledger }),
  tryGetApp: () => null,
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const ORG_ID = "org_1";
const USER_ID = "user_1";
const CUSTOM_ROLE_ID = "cr_1";

function buildMockPrisma() {
  // One flat client: the service no longer opens a transaction, because
  // everything it used to write inside one is a ledger command now.
  const client = {
    apiKey: {
      create: vi.fn().mockResolvedValue({
        id: "ak_1",
        name: "Test Key",
        userId: USER_ID,
        organizationId: ORG_ID,
        lookupId: "testlookup1234",
        hashedSecret: "hashedsecret123",
        permissionMode: "restricted",
        createdByUserId: null,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findUnique: vi.fn(),
      // Activation reads back the row it flips live, the way Prisma's update
      // answers with the updated record.
      update: vi.fn().mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({
          id: "ak_1",
          name: "Test Key",
          userId: USER_ID,
          organizationId: ORG_ID,
          lookupId: "testlookup1234",
          hashedSecret: "hashedsecret123",
          permissionMode: "restricted",
          createdByUserId: null,
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }),
      ),
    },
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue({
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    teamUser: { count: vi.fn().mockResolvedValue(0) },
    customRole: {
      // The natural-key check asks by (organizationId, name) and finds the
      // name free; a redefine asks by id and finds the role it rewrites.
      findUnique: vi.fn().mockImplementation(({ where }: any) =>
        where?.organizationId_name
          ? null
          : {
              id: where?.id ?? CUSTOM_ROLE_ID,
              organizationId: ORG_ID,
              name: "API Key: Old Key",
              description: null,
              permissions: ["traces:view", "annotations:manage"],
              kind: "system_api_key",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
      ),
      findFirst: vi.fn().mockResolvedValue({ id: CUSTOM_ROLE_ID }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ userId: USER_ID }),
    },
    team: {
      findFirst: vi.fn(),
    },
    project: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  return client as unknown as PrismaClient;
}

function buildCaller(prisma: PrismaClient) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: USER_ID }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = prisma;
  return apiKeyRouter.createCaller(ctx);
}

describe("apiKey router — restricted permissions", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let caller: ReturnType<typeof apiKeyRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.revokeBindings.mockResolvedValue(undefined);
    ledger.revokeBindingsWhere.mockResolvedValue(0);
    ledger.defineRole.mockResolvedValue(undefined);
    ledger.deleteRole.mockResolvedValue(undefined);
    prisma = buildMockPrisma();
    caller = buildCaller(prisma);
  });

  describe("create", () => {
    describe("when creating a restricted key with permissions", () => {
      it("succeeds and returns the new key", async () => {
        const result = await caller.create({
          organizationId: ORG_ID,
          name: "Restricted Key",
          permissionMode: "restricted",
          permissions: ["traces:view", "annotations:manage"],
          bindings: [
            {
              role: TeamUserRole.CUSTOM,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
        });

        expect(result.token).toBeDefined();
        expect(result.apiKey.id).toBe("ak_1");
      });

      /** @scenario Creating a restricted key creates a CustomRole and links it to bindings */
      it("persists the binding with a customRoleId", async () => {
        await caller.create({
          organizationId: ORG_ID,
          name: "Restricted Key",
          permissionMode: "restricted",
          permissions: ["traces:view", "annotations:manage"],
          bindings: [
            {
              role: TeamUserRole.CUSTOM,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
        });

        // The role is defined first, and the grant carries the id it minted.
        const definedRoleId = ledger.defineRole.mock.calls[0]![0].roleId;
        expect(ledger.attachBindings).toHaveBeenCalledWith(
          expect.objectContaining({
            bindings: [
              expect.objectContaining({
                role: TeamUserRole.CUSTOM,
                customRoleId: definedRoleId,
              }),
            ],
          }),
        );
      });
    });

    describe("when creating a restricted key with camelCase permissions", () => {
      /** @scenario Restricted key with camelCase permissions saves without error */
      it("accepts auditLog:view without malformed error", async () => {
        (prisma.customRole.findFirst as unknown as Mock).mockResolvedValue({
          id: CUSTOM_ROLE_ID,
          name: "API Key: Audit Key",
          permissions: ["auditLog:view"],
        });

        const result = await caller.create({
          organizationId: ORG_ID,
          name: "Audit Key",
          permissionMode: "restricted",
          permissions: ["auditLog:view"],
          bindings: [
            {
              role: TeamUserRole.CUSTOM,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
        });

        expect(result.token).toBeDefined();
        expect(result.apiKey.id).toBe("ak_1");
      });
    });
  });

  describe("update", () => {
    const existingKey = {
      id: "ak_1",
      name: "Old Key",
      userId: USER_ID,
      organizationId: ORG_ID,
      permissionMode: "all",
      revokedAt: null,
      roleBindings: [
        {
          id: "rb_1",
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: ORG_ID,
        },
      ],
    };

    describe("when switching from all to restricted (no existing CustomRole)", () => {
      /** @scenario Updating a key from All to Restricted upserts a CustomRole */
      it("succeeds and returns the updated key", async () => {
        // The pre-read sees the key as it was; the read-back after the write
        // sees the row the update left.
        (prisma.apiKey.findUnique as unknown as Mock)
          .mockResolvedValueOnce(existingKey)
          .mockResolvedValue({ ...existingKey, permissionMode: "restricted" });

        const result = await caller.update({
          organizationId: ORG_ID,
          apiKeyId: "ak_1",
          permissionMode: "restricted",
          permissions: ["traces:view", "annotations:manage"],
          bindings: [
            {
              role: TeamUserRole.CUSTOM,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
        });

        expect(result.id).toBe("ak_1");
        expect(result.permissionMode).toBe("restricted");
      });
    });

    describe("when updating an already-restricted key (existing CustomRole)", () => {
      const restrictedKey = {
        ...existingKey,
        permissionMode: "restricted",
        roleBindings: [
          {
            id: "rb_1",
            role: TeamUserRole.CUSTOM,
            customRoleId: CUSTOM_ROLE_ID,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: ORG_ID,
          },
        ],
      };

      it("mints a fresh CustomRole and deletes the one it replaces", async () => {
        // A fresh role is minted rather than the existing exclusive role
        // being updated in place: mutating it first left a crash window
        // where the key held new permissions with stale binding state. The
        // orphan cleanup after replaceRoleBindings deletes the superseded
        // role.
        (prisma.apiKey.findUnique as unknown as Mock).mockResolvedValue(restrictedKey);

        await caller.update({
          organizationId: ORG_ID,
          apiKeyId: "ak_1",
          permissionMode: "restricted",
          permissions: ["datasets:view", "datasets:manage"],
          bindings: [
            {
              role: TeamUserRole.CUSTOM,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
        });

        expect(ledger.defineRole).toHaveBeenCalledTimes(1);
        expect(ledger.defineRole).not.toHaveBeenCalledWith(
          expect.objectContaining({ roleId: CUSTOM_ROLE_ID }),
        );
        expect(ledger.deleteRole).toHaveBeenCalledWith(
          expect.objectContaining({ roleId: CUSTOM_ROLE_ID }),
        );
      });
    });

    describe("when updating restricted key with camelCase permissions", () => {
      it("accepts auditLog:view without malformed error", async () => {
        (prisma.apiKey.findUnique as unknown as Mock).mockResolvedValue(existingKey);
        (prisma.customRole.findFirst as unknown as Mock).mockResolvedValue({
          id: CUSTOM_ROLE_ID,
          name: "API Key: Old Key",
          permissions: ["auditLog:view"],
        });

        const result = await caller.update({
          organizationId: ORG_ID,
          apiKeyId: "ak_1",
          permissionMode: "restricted",
          permissions: ["auditLog:view"],
          bindings: [
            {
              role: TeamUserRole.CUSTOM,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
        });

        expect(result.id).toBe("ak_1");
      });
    });
  });
});
