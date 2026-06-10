import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { apiKeyRouter } from "../apiKey";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(
    () => () => "mock48characterrandomstringforapikeygeneration",
  ),
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

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/server/rbac/role-binding-resolver", () => ({
  checkRoleBindingPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/server/rbac/custom-role-permissions", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("~/server/rbac/custom-role-permissions")
  >();
  return {
    ...actual,
    parseCustomRolePermissions: vi
      .fn()
      .mockImplementation(actual.parseCustomRolePermissions),
  };
});

vi.mock("~/utils/logger/server", () => ({
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
  const mockTx = {
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
      update: vi.fn(),
    },
    roleBinding: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    customRole: {
      create: vi.fn().mockResolvedValue({
        id: CUSTOM_ROLE_ID,
        name: "API Key: Test",
        permissions: ["traces:view", "annotations:manage"],
      }),
      update: vi.fn().mockResolvedValue({
        id: CUSTOM_ROLE_ID,
        name: "API Key: Old Key",
        permissions: ["traces:view", "annotations:manage"],
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: CUSTOM_ROLE_ID,
        permissions: ["traces:view", "annotations:manage"],
      }),
      findFirst: vi.fn().mockResolvedValue({ id: CUSTOM_ROLE_ID }),
    },
  };

  return {
    $transaction: vi.fn(
      (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    ),
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ userId: USER_ID }),
    },
    apiKey: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue({
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      }),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    customRole: {
      create: vi.fn().mockResolvedValue({
        id: CUSTOM_ROLE_ID,
        name: "API Key: Test",
        permissions: ["traces:view", "annotations:manage"],
      }),
      update: vi.fn().mockResolvedValue({
        id: CUSTOM_ROLE_ID,
        name: "API Key: Old Key",
        permissions: ["traces:view", "annotations:manage"],
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: CUSTOM_ROLE_ID,
        permissions: ["traces:view", "annotations:manage"],
      }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    team: {
      findFirst: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    _mockTx: mockTx,
  } as any;
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

        expect(prisma._mockTx.roleBinding.createMany).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({
              role: TeamUserRole.CUSTOM,
              customRoleId: CUSTOM_ROLE_ID,
            }),
          ],
        });
      });
    });

    describe("when creating a restricted key with camelCase permissions", () => {
      /** @scenario Restricted key with camelCase permissions saves without error */
      it("accepts auditLog:view without malformed error", async () => {
        prisma._mockTx.customRole.create.mockResolvedValue({
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
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          permissionMode: "restricted",
        });
        prisma._mockTx.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          permissionMode: "restricted",
          roleBindings: [
            {
              id: "rb_new",
              role: TeamUserRole.CUSTOM,
              customRoleId: CUSTOM_ROLE_ID,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
        });

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

      it("updates the existing CustomRole instead of creating a new one", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(restrictedKey);
        prisma._mockTx.apiKey.update.mockResolvedValue(restrictedKey);
        prisma._mockTx.apiKey.findUnique.mockResolvedValue(restrictedKey);

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

        expect(prisma._mockTx.customRole.update).toHaveBeenCalled();
        expect(prisma._mockTx.customRole.create).not.toHaveBeenCalled();
      });
    });

    describe("when updating restricted key with camelCase permissions", () => {
      it("accepts auditLog:view without malformed error", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        prisma._mockTx.customRole.create.mockResolvedValue({
          id: CUSTOM_ROLE_ID,
          name: "API Key: Old Key",
          permissions: ["auditLog:view"],
        });
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          permissionMode: "restricted",
        });
        prisma._mockTx.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          permissionMode: "restricted",
          roleBindings: [
            {
              id: "rb_new",
              role: TeamUserRole.CUSTOM,
              customRoleId: CUSTOM_ROLE_ID,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: ORG_ID,
            },
          ],
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
