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
    },
    apiKey: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    roleBinding: {
      findFirst: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
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
});
