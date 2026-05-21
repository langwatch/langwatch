import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiKeyService } from "../api-key.service";

vi.mock("../api-key-token.utils", () => ({
  generateApiKeyToken: () => ({
    token: "sk-lw-testlookup1234_testsecret",
    lookupId: "testlookup1234",
    hashedSecret: "hashedsecret123",
  }),
  splitApiKeyToken: vi.fn(),
  verifySecret: vi.fn(),
  hashSecret: vi.fn().mockReturnValue("upgraded-hash"),
}));

const mockCheckPermission = vi.fn().mockResolvedValue(true);
vi.mock("~/server/rbac/role-binding-resolver", () => ({
  checkRoleBindingPermission: (...args: unknown[]) =>
    mockCheckPermission(...args),
}));

vi.mock("~/server/rbac/custom-role-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/rbac/custom-role-permissions")>();
  return {
    ...actual,
    parseCustomRolePermissions: vi.fn().mockReturnValue(["project:view"]),
    MalformedCustomRolePermissionsError: class extends Error {},
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

function buildPrisma() {
  const txState = {
    createdApiKey: null as any,
    createdCustomRole: null as any,
    createdBindings: [] as any[],
    updatedApiKey: null as any,
    replacedBindings: [] as any[],
  };

  const mockTx = {
    apiKey: {
      create: vi.fn().mockImplementation((args: any) => {
        txState.createdApiKey = { id: "ak_new", ...args.data, createdAt: new Date(), updatedAt: new Date() };
        return txState.createdApiKey;
      }),
      findUnique: vi.fn().mockImplementation(() => ({
        ...txState.createdApiKey,
        roleBindings: txState.createdBindings,
      })),
      update: vi.fn().mockImplementation((args: any) => {
        txState.updatedApiKey = { ...txState.createdApiKey, ...args.data };
        return txState.updatedApiKey;
      }),
    },
    roleBinding: {
      createMany: vi.fn().mockImplementation((args: any) => {
        txState.createdBindings = args.data;
        return { count: args.data.length };
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    customRole: {
      create: vi.fn().mockImplementation((args: any) => {
        txState.createdCustomRole = { id: "cr_new", ...args.data };
        return txState.createdCustomRole;
      }),
      update: vi.fn().mockImplementation((args: any) => {
        const roleId = args.where?.id ?? txState.createdCustomRole?.id ?? "cr_updated";
        txState.createdCustomRole = { id: roleId, ...txState.createdCustomRole, ...args.data };
        return txState.createdCustomRole;
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };

  return {
    prisma: {
      $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
      organizationUser: {
        findFirst: vi.fn().mockResolvedValue({ userId: USER_ID }),
      },
      apiKey: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockImplementation((args: any) => ({ id: args.where.id, ...args.data })),
      },
      roleBinding: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      customRole: {
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      team: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      project: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      organization: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as any,
    mockTx,
    txState,
  };
}

describe("ApiKeyService — safety invariants (mocked)", () => {
  let prisma: ReturnType<typeof buildPrisma>["prisma"];
  let mockTx: ReturnType<typeof buildPrisma>["mockTx"];
  let txState: ReturnType<typeof buildPrisma>["txState"];
  let service: ApiKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    const built = buildPrisma();
    prisma = built.prisma;
    mockTx = built.mockTx;
    txState = built.txState;
    service = ApiKeyService.create(prisma);
    mockCheckPermission.mockResolvedValue(true);
  });

  describe("create restricted key", () => {
    describe("when ceiling rejects a permission", () => {
      /** @scenario Service rejects permissions above creator ceiling */
      it("throws before creating any CustomRole or ApiKey", async () => {
        mockCheckPermission.mockResolvedValue(false);

        await expect(
          service.create({
            name: "Forbidden Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["secrets:manage"],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("exceeds your own access");

        expect(mockTx.customRole.create).not.toHaveBeenCalled();
        expect(mockTx.apiKey.create).not.toHaveBeenCalled();
      });
    });

    describe("when permissions are within ceiling", () => {
      /** @scenario Creating key with restricted permissions stores a CustomRole */
      it("creates ApiKey first, then CustomRole using the key's id", async () => {
        const result = await service.create({
          name: "Restricted Key",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["traces:view", "annotations:manage"],
          bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        expect(result.token).toBeDefined();

        expect(mockTx.apiKey.create).toHaveBeenCalledBefore(mockTx.customRole.create);

        expect(mockTx.customRole.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            name: "apikey:ak_new",
            permissions: ["annotations:manage", "traces:view"],
          }),
        });
      });
    });

    describe("when permissions arrive in arbitrary order", () => {
      /** @scenario Service stores CustomRole permissions as sorted array */
      it("sorts them alphabetically before persisting", async () => {
        await service.create({
          name: "Sorted Key",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["workflows:manage", "annotations:view", "datasets:view"],
          bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        const storedPermissions = mockTx.customRole.create.mock.calls[0]![0].data.permissions;
        expect(storedPermissions).toEqual(["annotations:view", "datasets:view", "workflows:manage"]);
      });
    });

    describe("when scope points to a project in another org", () => {
      /** @scenario Service validates scope belongs to organization */
      it("rejects with scope violation", async () => {
        prisma.project.findUnique.mockResolvedValue({
          id: "proj_other",
          team: { id: "team_other", organizationId: "org_other" },
        });

        await expect(
          service.create({
            name: "Cross Org Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["traces:view"],
            bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "proj_other" }],
          }),
        ).rejects.toThrow("does not belong to this organization");
      });
    });

    describe("when two keys share the same name", () => {
      it("creates CustomRoles with different names using the key id", async () => {
        const result1 = await service.create({
          name: "Duplicate Name",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["traces:view"],
          bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        const roleName = mockTx.customRole.create.mock.calls[0]![0].data.name;
        expect(roleName).toBe(`apikey:${result1.apiKey.id}`);
        expect(roleName).not.toContain("Duplicate Name");
      });
    });
  });

  describe("update restricted key — ownership safety", () => {
    const existingKey = {
      id: "ak_existing",
      name: "Existing Key",
      userId: USER_ID,
      organizationId: ORG_ID,
      permissionMode: "restricted",
      revokedAt: null,
      roleBindings: [
        { id: "rb_1", customRoleId: "cr_owned", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
      ],
    };

    describe("when existing CustomRole is exclusively owned by this key", () => {
      it("updates the existing CustomRole in place", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        mockTx.customRole.findFirst.mockResolvedValue({ id: "cr_owned" });
        mockTx.apiKey.findUnique.mockResolvedValue({ ...existingKey, roleBindings: existingKey.roleBindings });

        await service.update({
          id: "ak_existing",
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["datasets:view", "datasets:manage"],
          bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        expect(mockTx.customRole.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: "cr_owned" } }),
        );
        expect(mockTx.customRole.create).not.toHaveBeenCalled();
      });
    });

    describe("when existing CustomRole is shared with another key", () => {
      it("creates a new CustomRole instead of mutating the shared one", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        mockTx.customRole.findFirst.mockResolvedValue(null);
        mockTx.apiKey.findUnique.mockResolvedValue({ ...existingKey, roleBindings: existingKey.roleBindings });

        await service.update({
          id: "ak_existing",
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["traces:view"],
          bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        expect(mockTx.customRole.update).not.toHaveBeenCalled();
        expect(mockTx.customRole.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            name: expect.stringMatching(/^apikey:ak_existing:apikeyrole_[0-9A-Za-z]+$/),
          }),
        });
      });
    });

    describe("when ceiling rejects updated permissions", () => {
      it("throws before any CustomRole mutation", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        mockCheckPermission.mockResolvedValue(false);

        await expect(
          service.update({
            id: "ak_existing",
            callerUserId: USER_ID,
            callerIsAdmin: false,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["secrets:manage"],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("exceeds your own access");

        expect(mockTx.customRole.update).not.toHaveBeenCalled();
        expect(mockTx.customRole.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("revoke — CustomRole cleanup", () => {
    describe("when custom role is exclusively bound to the revoked key", () => {
      it("deletes the custom role", async () => {
        const keyWithExclusive = {
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: "cr_exclusive", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        };
        prisma.apiKey.findUnique.mockResolvedValue(keyWithExclusive);
        mockTx.apiKey.findUnique.mockResolvedValue(keyWithExclusive);
        mockTx.apiKey.update.mockResolvedValue({ id: "ak_1", revokedAt: new Date() });

        await service.revoke({
          id: "ak_1",
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
        });

        expect(mockTx.customRole.deleteMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["cr_exclusive"] },
            roleBindings: { every: { apiKeyId: "ak_1" } },
            assignedUsers: { none: {} },
          },
        });
      });
    });

    describe("when custom role is shared with another key", () => {
      it("deleteMany is called but the every filter protects the shared role", async () => {
        const keyWithShared = {
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: "cr_shared", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        };
        prisma.apiKey.findUnique.mockResolvedValue(keyWithShared);
        mockTx.apiKey.findUnique.mockResolvedValue(keyWithShared);
        mockTx.apiKey.update.mockResolvedValue({ id: "ak_1", revokedAt: new Date() });

        await service.revoke({
          id: "ak_1",
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
        });

        expect(mockTx.customRole.deleteMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["cr_shared"] },
            roleBindings: { every: { apiKeyId: "ak_1" } },
            assignedUsers: { none: {} },
          },
        });
      });
    });

    describe("when key has no custom roles (All mode)", () => {
      it("skips custom role deletion entirely", async () => {
        const keyWithNoCustom = {
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: null, role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        };
        prisma.apiKey.findUnique.mockResolvedValue(keyWithNoCustom);
        mockTx.apiKey.findUnique.mockResolvedValue(keyWithNoCustom);
        mockTx.apiKey.update.mockResolvedValue({ id: "ak_1", revokedAt: new Date() });

        await service.revoke({
          id: "ak_1",
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
        });

        expect(mockTx.customRole.deleteMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("ceiling validation — bounded All mode", () => {
    describe("when member creates an ADMIN-scoped key", () => {
      /** @scenario "All" mode is bounded by user ceiling */
      it("rejects because ADMIN exceeds MEMBER ceiling", async () => {
        mockCheckPermission.mockResolvedValue(false);

        await expect(
          service.create({
            name: "All Mode Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("exceeds your own access");
      });
    });

    describe("when member creates a MEMBER-scoped key", () => {
      it("succeeds because MEMBER matches their ceiling", async () => {
        mockCheckPermission.mockResolvedValue(true);

        const result = await service.create({
          name: "All Mode Key",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "all",
          bindings: [{ role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        expect(result.token).toBeDefined();
      });
    });
  });

  describe("input validation — permission/binding invariants", () => {
    describe("when create sends CUSTOM bindings with empty permissions", () => {
      it("rejects before any persistence", async () => {
        await expect(
          service.create({
            name: "Empty Perms Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: [],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("CUSTOM bindings require at least one permission");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when update sends permissions without bindings", () => {
      it("rejects before any persistence", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "all",
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: null, role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });

        await expect(
          service.update({
            id: "ak_1",
            callerUserId: USER_ID,
            callerIsAdmin: false,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["traces:view"],
          }),
        ).rejects.toThrow("restricted mode requires bindings with at least one CUSTOM role");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when update sends CUSTOM bindings with empty permissions", () => {
      it("rejects before any persistence", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: "cr_1", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });

        await expect(
          service.update({
            id: "ak_1",
            callerUserId: USER_ID,
            callerIsAdmin: false,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: [],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("CUSTOM bindings require at least one permission");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
    describe("when create sends restricted mode with only built-in bindings", () => {
      it("rejects because restricted requires CUSTOM binding", async () => {
        await expect(
          service.create({
            name: "Restricted No Custom",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("restricted mode requires at least one CUSTOM binding");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when create sends permissions with only built-in bindings", () => {
      it("rejects because permissions require CUSTOM binding", async () => {
        await expect(
          service.create({
            name: "Perms No Custom",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["traces:view"],
            bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("restricted mode requires at least one CUSTOM binding");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when update sends CUSTOM bindings without permissionMode restricted", () => {
      it("rejects because CUSTOM requires restricted", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "all",
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: null, role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });

        await expect(
          service.update({
            id: "ak_1",
            callerUserId: USER_ID,
            callerIsAdmin: false,
            organizationId: ORG_ID,
            permissions: ["traces:view"],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("CUSTOM permissions require permissionMode 'restricted'");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
  });

  describe("permission format validation", () => {
    describe("when create sends malformed permission strings", () => {
      it("rejects before any persistence", async () => {
        await expect(
          service.create({
            name: "Bad Perms Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["TRACES:VIEW"],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("Invalid permission format");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when create sends permission without colon separator", () => {
      it("rejects before any persistence", async () => {
        await expect(
          service.create({
            name: "No Colon Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["tracesview"],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("Invalid permission format");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when update sends malformed permission strings", () => {
      it("rejects before any persistence", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: "cr_1", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });

        await expect(
          service.update({
            id: "ak_1",
            callerUserId: USER_ID,
            callerIsAdmin: false,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["foo"],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("Invalid permission format");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });

    describe("when service key (no userId) sends malformed permissions", () => {
      it("rejects even without ceiling checks", async () => {
        await expect(
          service.create({
            name: "Service Bad Perms",
            userId: null,
            organizationId: ORG_ID,
            permissionMode: "restricted",
            permissions: ["a:b:c"],
            bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ).rejects.toThrow("Invalid permission format");

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
  });

  describe("update — orphan CustomRole cleanup on mode switch", () => {
    describe("when switching from restricted to all", () => {
      it("deletes the orphaned exclusive CustomRole", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: "cr_orphan", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });
        mockTx.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          name: "Switched Key",
          permissionMode: "all",
          roleBindings: [
            { id: "rb_2", customRoleId: null, role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });

        await service.update({
          id: "ak_1",
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
          permissionMode: "all",
          bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        expect(mockTx.customRole.deleteMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["cr_orphan"] },
            roleBindings: { every: { apiKeyId: "ak_1" } },
            assignedUsers: { none: {} },
          },
        });
      });
    });

    describe("when staying restricted with same custom role", () => {
      it("does not delete the still-referenced role", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          userId: USER_ID,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          revokedAt: null,
          roleBindings: [
            { id: "rb_1", customRoleId: "cr_reused", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });
        mockTx.customRole.findFirst.mockResolvedValue({ id: "cr_reused" });
        mockTx.apiKey.findUnique.mockResolvedValue({
          id: "ak_1",
          name: "Still Restricted",
          permissionMode: "restricted",
          roleBindings: [
            { id: "rb_2", customRoleId: "cr_reused", role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID },
          ],
        });

        await service.update({
          id: "ak_1",
          callerUserId: USER_ID,
          callerIsAdmin: false,
          organizationId: ORG_ID,
          permissionMode: "restricted",
          permissions: ["traces:view", "annotations:manage"],
          bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        });

        expect(mockTx.customRole.deleteMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("scope validation", () => {
    describe("when team does not belong to the organization", () => {
      it("rejects with scope violation", async () => {
        prisma.team.findFirst.mockResolvedValue(null);

        await expect(
          service.create({
            name: "Bad Team Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "TEAM", scopeId: "team_unknown" }],
          }),
        ).rejects.toThrow("not found in this organization");
      });
    });

    describe("when org scope mismatches the key's organization", () => {
      it("rejects with scope violation", async () => {
        await expect(
          service.create({
            name: "Wrong Org Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: "org_other" }],
          }),
        ).rejects.toThrow("Organization scope must match");
      });
    });

    describe("when project is archived", () => {
      it("rejects with scope violation", async () => {
        prisma.project.findUnique.mockResolvedValue(null);

        await expect(
          service.create({
            name: "Archived Project Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "proj_archived" }],
          }),
        ).rejects.toThrow("not found or archived");
      });
    });
  });
});
