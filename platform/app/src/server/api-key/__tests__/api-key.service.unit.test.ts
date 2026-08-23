import { beforeEach, describe, expect, it, vi } from "vitest";
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
  // These cases are about the binding path; the legacy fallback grants
  // nothing so the binding decision is the only one under test.
  resolveLegacyCeiling: vi.fn().mockResolvedValue({ grants: () => false }),
}));

// Mock the custom role permissions module
vi.mock("~/server/rbac/custom-role-permissions", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/rbac/custom-role-permissions")
    >();
  return {
    ...actual,
    parseCustomRolePermissions: vi.fn().mockReturnValue(["project:view"]),
    MalformedCustomRolePermissionsError: class extends Error {},
  };
});

// Grants and role definitions are ledger commands since ADR-092
// delivery-plan PR 2, so the writer is the seam these cases observe.
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

// Mock the logger
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * One flat client. The service used to open a transaction and re-bind its
 * repositories to it; grants and role definitions are ledger commands now, so
 * the remaining table writes are plain calls on the client itself. `_mockTx`
 * stays as an alias so the cases read the same stubs either way.
 */
function createMockPrisma() {
  const client = {
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
      // Prisma answers an update with the row as it now stands, which is what
      // the create path's activation (revokedAt back to null) returns to its
      // caller.
      update: vi.fn().mockImplementation(async (args: any) => {
        const created = await client.apiKey.create.mock.results.at(-1)?.value;
        return { ...(created ?? { id: args.where.id }), ...args.data };
      }),
    },
    roleBinding: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      // Nothing but this key holds the key's private role.
      count: vi.fn().mockResolvedValue(0),
    },
    // The personal-workspace guard reads the scopes a binding names.
    team: { findFirst: vi.fn().mockResolvedValue(null) },
    project: { findFirst: vi.fn().mockResolvedValue(null) },
    teamUser: { count: vi.fn().mockResolvedValue(0) },
    customRole: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ userId: "user_1" }),
    },
  };

  return { ...client, _mockTx: client } as any;
}

describe("ApiKeyService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ApiKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.revokeBindings.mockResolvedValue(undefined);
    ledger.revokeBindingsWhere.mockResolvedValue(0);
    ledger.defineRole.mockResolvedValue(undefined);
    ledger.deleteRole.mockResolvedValue(undefined);
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

        expect(ledger.attachBindings).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org_1",
            bindings: [
              expect.objectContaining({
                principal: { apiKeyId: "ak_svc" },
                role: "ADMIN",
                scopeType: "ORGANIZATION",
                scopeId: "org_1",
              }),
            ],
          }),
        );
      });
    });
  });

  describe("create() ceiling validation ordering", () => {
    describe("when ceiling check rejects permissions", () => {
      it("does not create a CustomRole", async () => {
        const { checkRoleBindingPermission } = await import(
          "~/server/rbac/role-binding-resolver"
        );
        (
          checkRoleBindingPermission as ReturnType<typeof vi.fn>
        ).mockResolvedValue(false);

        await expect(
          service.create({
            name: "Forbidden Key",
            userId: "user_1",
            organizationId: "org_1",
            permissionMode: "restricted",
            permissions: ["secrets:manage"],
            bindings: [
              {
                role: "CUSTOM" as const,
                scopeType: "ORGANIZATION" as const,
                scopeId: "org_1",
              },
            ],
          }),
        ).rejects.toThrow("exceeds your own access");

        expect(ledger.defineRole).not.toHaveBeenCalled();

        (
          checkRoleBindingPermission as ReturnType<typeof vi.fn>
        ).mockResolvedValue(true);
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
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          name: "New Name",
        });
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
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          name: "Admin Edit",
        });
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
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        await service.revoke({
          id: "ak_1",
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: "org_1",
        });

        expect(prisma._mockTx.apiKey.update).toHaveBeenCalledWith(
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
        prisma._mockTx.apiKey.update.mockResolvedValue({
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

        expect(prisma._mockTx.apiKey.update).toHaveBeenCalled();
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

    describe("when revoking a key with an API-key-owned CustomRole", () => {
      it("deletes only roles with the API Key: naming prefix", async () => {
        const keyWithCustomRole = {
          ...existingKey,
          roleBindings: [
            {
              id: "rb_1",
              customRoleId: "cr_1",
              role: "CUSTOM",
              scopeType: "ORGANIZATION",
              scopeId: "org_1",
            },
          ],
        };
        prisma.apiKey.findUnique.mockResolvedValue(keyWithCustomRole);
        prisma._mockTx.apiKey.findUnique.mockResolvedValue(keyWithCustomRole);
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        await service.revoke({
          id: "ak_1",
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: "org_1",
        });

        expect(ledger.deleteRole).toHaveBeenCalledTimes(1);
        expect(ledger.deleteRole).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: "org_1", roleId: "cr_1" }),
        );
      });
    });

    describe("when the caller leaves the projection hold to a later write", () => {
      /** @scenario "Rotating a key answers without waiting on the old key's cleanup" */
      it("passes the skipped hold through to the role deletion", async () => {
        const keyWithCustomRole = {
          ...existingKey,
          roleBindings: [
            {
              id: "rb_1",
              customRoleId: "cr_1",
              role: "CUSTOM",
              scopeType: "ORGANIZATION",
              scopeId: "org_1",
            },
          ],
        };
        prisma.apiKey.findUnique.mockResolvedValue(keyWithCustomRole);
        prisma._mockTx.apiKey.findUnique.mockResolvedValue(keyWithCustomRole);
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        const revoked = await service.revoke({
          id: "ak_1",
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: "org_1",
          awaitProjection: false,
        });

        // The key row itself is revoked imperatively either way.
        expect(revoked.revokedAt).not.toBeNull();
        expect(ledger.deleteRole).toHaveBeenCalledWith(
          expect.objectContaining({ roleId: "cr_1", awaitProjection: false }),
        );
      });
    });

    describe("when revoking a key with multiple bindings sharing one CustomRole", () => {
      it("deduplicates and deletes the CustomRole once", async () => {
        const keyWithSharedRole = {
          ...existingKey,
          roleBindings: [
            {
              id: "rb_1",
              customRoleId: "cr_1",
              role: "CUSTOM",
              scopeType: "PROJECT",
              scopeId: "p_1",
            },
            {
              id: "rb_2",
              customRoleId: "cr_1",
              role: "CUSTOM",
              scopeType: "PROJECT",
              scopeId: "p_2",
            },
          ],
        };
        prisma.apiKey.findUnique.mockResolvedValue(keyWithSharedRole);
        prisma._mockTx.apiKey.findUnique.mockResolvedValue(keyWithSharedRole);
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        await service.revoke({
          id: "ak_1",
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: "org_1",
        });

        expect(ledger.deleteRole).toHaveBeenCalledTimes(1);
        expect(ledger.deleteRole).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: "org_1", roleId: "cr_1" }),
        );
      });
    });

    describe("when revoking a key with no CustomRole (ADMIN bindings)", () => {
      it("deletes no role", async () => {
        const keyWithAdminOnly = {
          ...existingKey,
          roleBindings: [
            {
              id: "rb_1",
              customRoleId: null,
              role: "ADMIN",
              scopeType: "ORGANIZATION",
              scopeId: "org_1",
            },
          ],
        };
        prisma.apiKey.findUnique.mockResolvedValue(keyWithAdminOnly);
        prisma._mockTx.apiKey.findUnique.mockResolvedValue(keyWithAdminOnly);
        prisma._mockTx.apiKey.update.mockResolvedValue({
          ...existingKey,
          revokedAt: new Date(),
        });

        await service.revoke({
          id: "ak_1",
          callerUserId: "user_1",
          callerIsAdmin: false,
          organizationId: "org_1",
        });

        expect(ledger.deleteRole).not.toHaveBeenCalled();
      });
    });
  });
});
