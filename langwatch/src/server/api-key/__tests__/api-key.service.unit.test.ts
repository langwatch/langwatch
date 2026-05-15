import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiKeyService } from "../api-key.service";

// Mock the token generator to produce deterministic values
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

// Mock the role binding permission check
vi.mock("~/server/rbac/role-binding-resolver", () => ({
  checkRoleBindingPermission: vi.fn().mockResolvedValue(true),
}));

// Mock the custom role permissions module
vi.mock("~/server/rbac/custom-role-permissions", () => ({
  parseCustomRolePermissions: vi.fn().mockReturnValue(["project:view"]),
  MalformedCustomRolePermissionsError: class extends Error {},
}));

// Mock the logger
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockPrisma() {
  const mockTx = {
    apiKey: {
      create: vi.fn().mockResolvedValue({
        id: "ak_1",
        name: "Test Key",
        userId: "user_1",
        organizationId: "org_1",
        lookupId: "testlookup1234",
        hashedSecret: "hashedsecret123",
        permissionMode: "all",
        createdByUserId: null,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    roleBinding: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };

  return {
    $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ userId: "user_1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    apiKey: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    roleBinding: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    team: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    project: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    customRole: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    _mockTx: mockTx,
  } as any;
}

describe("ApiKeyService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ApiKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = ApiKeyService.create(prisma);
  });

  describe("create()", () => {
    describe("when creating a personal API key", () => {
      it("asserts org membership and returns token", async () => {
        const result = await service.create({
          name: "CI Key",
          userId: "user_1",
          organizationId: "org_1",
          permissionMode: "all",
          bindings: [
            {
              role: "ADMIN" as const,
              scopeType: "ORGANIZATION" as const,
              scopeId: "org_1",
            },
          ],
        });

        expect(result.token).toBe("sk-lw-testlookup1234_testsecret");
        expect(result.apiKey.id).toBe("ak_1");
        expect(prisma.organizationUser.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: "user_1", organizationId: "org_1" },
          }),
        );
      });

      it("rejects when user is not in the organization", async () => {
        prisma.organizationUser.findFirst.mockResolvedValue(null);

        await expect(
          service.create({
            name: "CI Key",
            userId: "user_1",
            organizationId: "org_1",
            permissionMode: "all",
            bindings: [],
          }),
        ).rejects.toThrow("Not a member of this organization");
      });
    });

    describe("when creating a service API key", () => {
      it("skips org membership and ceiling checks", async () => {
        prisma._mockTx.apiKey.create.mockResolvedValue({
          id: "ak_svc",
          name: "Service Key",
          userId: null,
          organizationId: "org_1",
          lookupId: "testlookup1234",
          hashedSecret: "hashedsecret123",
          permissionMode: "all",
          createdByUserId: "admin_1",
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const result = await service.create({
          name: "Service Key",
          userId: null,
          createdByUserId: "admin_1",
          organizationId: "org_1",
          permissionMode: "all",
          bindings: [],
        });

        expect(result.apiKey.userId).toBeNull();
        expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
      });

      it("auto-creates an ORG-scoped ADMIN binding for full access", async () => {
        prisma._mockTx.apiKey.create.mockResolvedValue({
          id: "ak_svc",
          name: "Service Key",
          userId: null,
          organizationId: "org_1",
          lookupId: "testlookup1234",
          hashedSecret: "hashedsecret123",
          permissionMode: "all",
          createdByUserId: "admin_1",
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await service.create({
          name: "Service Key",
          userId: null,
          createdByUserId: "admin_1",
          organizationId: "org_1",
          permissionMode: "all",
          bindings: [],
        });

        expect(prisma._mockTx.roleBinding.createMany).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({
              organizationId: "org_1",
              apiKeyId: "ak_svc",
              role: "ADMIN",
              scopeType: "ORGANIZATION",
              scopeId: "org_1",
            }),
          ],
        });
      });
    });
  });

  describe("update()", () => {
    const existingKey = {
      id: "ak_1",
      name: "Old Name",
      userId: "user_1",
      organizationId: "org_1",
      permissionMode: "all",
      revokedAt: null,
      roleBindings: [],
    };

    describe("when owner updates their own key", () => {
      it("updates the key name", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        prisma._mockTx.apiKey.update.mockResolvedValue({ ...existingKey, name: "New Name" });
        prisma._mockTx.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          name: "New Name",
          roleBindings: [],
        });

        const result = await service.update({
          id: "ak_1",
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: "org_1",
          name: "New Name",
        });

        expect(result.name).toBe("New Name");
      });
    });

    describe("when non-owner non-admin tries to update", () => {
      it("rejects with not-owned error", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);

        await expect(
          service.update({
            id: "ak_1",
            callerUserId: "other_user",
            callerIsAdmin: false,
            organizationId: "org_1",
            name: "Hacked",
          }),
        ).rejects.toThrow();
      });
    });

    describe("when admin updates another user's key", () => {
      it("succeeds", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        prisma._mockTx.apiKey.update.mockResolvedValue({ ...existingKey, name: "Admin Edit" });
        prisma._mockTx.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          name: "Admin Edit",
          roleBindings: [],
        });

        const result = await service.update({
          id: "ak_1",
          callerUserId: "admin_user",
          callerIsAdmin: true,
          organizationId: "org_1",
          name: "Admin Edit",
        });

        expect(result.name).toBe("Admin Edit");
      });
    });

    describe("when non-admin tries to update a service key", () => {
      it("rejects with not-owned error", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          userId: null,
        });

        await expect(
          service.update({
            id: "ak_1",
            callerUserId: "user_1",
            callerIsAdmin: false,
            organizationId: "org_1",
            name: "Attempt",
          }),
        ).rejects.toThrow();
      });
    });

    describe("when updating a revoked key", () => {
      it("rejects with already-revoked error", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        await expect(
          service.update({
            id: "ak_1",
            callerUserId: "user_1",
            callerIsAdmin: false,
            organizationId: "org_1",
            name: "Attempt",
          }),
        ).rejects.toThrow();
      });
    });
  });

  describe("revoke()", () => {
    const existingKey = {
      id: "ak_1",
      name: "Key",
      userId: "user_1",
      organizationId: "org_1",
      revokedAt: null,
      roleBindings: [],
    };

    describe("when owner revokes their own key", () => {
      it("sets revokedAt", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);
        prisma.apiKey.update.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        await service.revoke({
          id: "ak_1",
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: "org_1",
        });

        expect(prisma.apiKey.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "ak_1" },
            data: expect.objectContaining({ revokedAt: expect.any(Date) }),
          }),
        );
      });
    });

    describe("when non-owner non-admin tries to revoke", () => {
      it("rejects with not-owned error", async () => {
        prisma.apiKey.findUnique.mockResolvedValue(existingKey);

        await expect(
          service.revoke({
            id: "ak_1",
            callerUserId: "other_user",
            callerIsAdmin: false,
            organizationId: "org_1",
          }),
        ).rejects.toThrow();
      });
    });

    describe("when admin revokes a service key", () => {
      it("succeeds", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          userId: null,
        });
        prisma.apiKey.update.mockResolvedValue({
          ...existingKey,
          userId: null,
          revokedAt: new Date(),
        });

        await service.revoke({
          id: "ak_1",
          callerUserId: "admin_user",
          callerIsAdmin: true,
          organizationId: "org_1",
        });

        expect(prisma.apiKey.update).toHaveBeenCalled();
      });
    });

    describe("when non-admin tries to revoke a service key", () => {
      it("rejects", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          userId: null,
        });

        await expect(
          service.revoke({
            id: "ak_1",
            callerUserId: "user_1",
            callerIsAdmin: false,
            organizationId: "org_1",
          }),
        ).rejects.toThrow();
      });
    });

    describe("when revoking an already-revoked key", () => {
      it("rejects", async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        await expect(
          service.revoke({
            id: "ak_1",
            callerUserId: "user_1",
            callerIsAdmin: false,
            organizationId: "org_1",
          }),
        ).rejects.toThrow();
      });
    });
  });

  describe("getMyBindings()", () => {
    describe("when user has active bindings", () => {
      it("returns bindings with resolved scope names", async () => {
        prisma.roleBinding.findMany.mockResolvedValue([
          { id: "rb_1", role: "ADMIN", customRoleId: null, scopeType: "ORGANIZATION", scopeId: "org_1" },
          { id: "rb_2", role: "MEMBER", customRoleId: null, scopeType: "PROJECT", scopeId: "proj_1" },
        ]);
        prisma.organization.findMany.mockResolvedValue([{ id: "org_1", name: "Acme Corp" }]);
        prisma.project.findMany.mockResolvedValue([{ id: "proj_1", name: "My Project" }]);

        const result = await service.getMyBindings({ userId: "user_1", organizationId: "org_1" });

        expect(result).toEqual([
          expect.objectContaining({ id: "rb_1", scopeName: "Acme Corp" }),
          expect.objectContaining({ id: "rb_2", scopeName: "My Project" }),
        ]);
      });
    });

    describe("when user has archived project bindings", () => {
      it("excludes archived project bindings", async () => {
        prisma.roleBinding.findMany.mockResolvedValue([
          { id: "rb_1", role: "ADMIN", customRoleId: null, scopeType: "ORGANIZATION", scopeId: "org_1" },
          { id: "rb_2", role: "MEMBER", customRoleId: null, scopeType: "PROJECT", scopeId: "archived_proj" },
        ]);
        prisma.organization.findMany.mockResolvedValue([{ id: "org_1", name: "Acme Corp" }]);
        prisma.project.findMany.mockResolvedValue([]);

        const result = await service.getMyBindings({ userId: "user_1", organizationId: "org_1" });

        expect(result).toHaveLength(1);
      });
    });

    describe("when user has custom role bindings", () => {
      it("includes custom role names", async () => {
        prisma.roleBinding.findMany.mockResolvedValue([
          { id: "rb_1", role: "CUSTOM", customRoleId: "cr_1", scopeType: "ORGANIZATION", scopeId: "org_1" },
        ]);
        prisma.organization.findMany.mockResolvedValue([{ id: "org_1", name: "Acme Corp" }]);
        prisma.customRole.findMany.mockResolvedValue([{ id: "cr_1", name: "Deployer" }]);

        const result = await service.getMyBindings({ userId: "user_1", organizationId: "org_1" });

        expect(result[0]!.customRoleName).toBe("Deployer");
      });
    });

    describe("when user is not an org member", () => {
      it("throws scope violation error", async () => {
        prisma.organizationUser.findFirst.mockResolvedValue(null);

        await expect(
          service.getMyBindings({ userId: "user_1", organizationId: "org_1" }),
        ).rejects.toThrow("Not a member of this organization");
      });
    });
  });

  describe("getApiKeysWithNames()", () => {
    describe("when caller is admin", () => {
      it("returns all org keys with enriched names", async () => {
        prisma.apiKey.findMany.mockResolvedValue([
          {
            id: "ak_1",
            name: "Key 1",
            description: null,
            lookupId: "lookup1234567890",
            permissionMode: "all",
            userId: "user_1",
            createdByUserId: "user_1",
            organizationId: "org_1",
            createdAt: new Date(),
            expiresAt: null,
            lastUsedAt: null,
            revokedAt: null,
            roleBindings: [
              { id: "rb_1", role: "ADMIN", customRoleId: null, scopeType: "ORGANIZATION", scopeId: "org_1" },
            ],
          },
        ]);
        prisma.organization.findMany.mockResolvedValue([{ id: "org_1", name: "Acme Corp" }]);
        prisma.user.findMany.mockResolvedValue([{ id: "user_1", name: "Alice", email: "alice@acme.com" }]);

        const result = await service.getApiKeysWithNames({
          userId: "user_1",
          organizationId: "org_1",
          isAdmin: true,
        });

        expect(result[0]!.userName).toBe("Alice");
      });
    });

    describe("when caller is not admin", () => {
      it("returns only user's own keys", async () => {
        prisma.apiKey.findMany.mockResolvedValue([]);

        const result = await service.getApiKeysWithNames({
          userId: "user_1",
          organizationId: "org_1",
          isAdmin: false,
        });

        expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ organizationId: "org_1" }),
          }),
        );
        expect(result).toEqual([]);
      });
    });
  });

  describe("getOrgProjects()", () => {
    describe("when org has active projects", () => {
      it("returns non-archived projects ordered by name", async () => {
        prisma.project.findMany.mockResolvedValue([
          { id: "proj_1", name: "Alpha" },
          { id: "proj_2", name: "Beta" },
        ]);

        const result = await service.getOrgProjects({ userId: "user_1", organizationId: "org_1" });

        expect(result).toEqual([
          { id: "proj_1", name: "Alpha" },
          { id: "proj_2", name: "Beta" },
        ]);
      });
    });

    describe("when user is not an org member", () => {
      it("throws scope violation error", async () => {
        prisma.organizationUser.findFirst.mockResolvedValue(null);

        await expect(
          service.getOrgProjects({ userId: "user_1", organizationId: "org_1" }),
        ).rejects.toThrow("Not a member of this organization");
      });
    });
  });

  describe("getOrgMembers()", () => {
    describe("when caller is admin", () => {
      it("returns org members with user details", async () => {
        prisma.roleBinding.findFirst.mockResolvedValue({ id: "rb_admin" });
        prisma.organizationUser.findMany.mockResolvedValue([
          { user: { id: "user_1", name: "Alice", email: "alice@acme.com" } },
          { user: { id: "user_2", name: null, email: "bob@acme.com" } },
        ]);

        const result = await service.getOrgMembers({ userId: "user_1", organizationId: "org_1" });

        expect(result).toEqual([
          { id: "user_1", name: "Alice", email: "alice@acme.com" },
          { id: "user_2", name: null, email: "bob@acme.com" },
        ]);
      });
    });

    describe("when caller is not admin", () => {
      it("returns empty array", async () => {
        prisma.roleBinding.findFirst.mockResolvedValue(null);

        const result = await service.getOrgMembers({ userId: "user_1", organizationId: "org_1" });

        expect(result).toEqual([]);
      });
    });
  });
});
