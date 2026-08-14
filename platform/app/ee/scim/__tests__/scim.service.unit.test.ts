// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, User } from "~/generated/prisma/client";
import { ScimService } from "../scim.service";

// An App carrying no Redis, so the revoke helper reachable from the SCIM
// deactivation paths takes its Postgres-only path instead of talking to a real
// Redis from a unit test.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

// A directory push is reconciled against the projection and emitted as
// grants-ledger commands (ADR-092 decision 18), so the writer is the seam.
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  offboardMember: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

function createMockPrisma() {
  // The reconciler reads the grants this push is authoritative over. The
  // write path must never reach the three write methods: since PR 2 the
  // tables are projection-fed and the ledger is the only writer. Each throws
  // so a regression reads as this named failure rather than as a mock
  // missing a method.
  const forbiddenWrite = (method: string) =>
    vi.fn().mockImplementation(() => {
      throw new Error(
        `roleBinding.${method} reached from ScimService — the grants ledger is the only writer`,
      );
    });
  const roleBinding = {
    findMany: vi.fn().mockResolvedValue([]),
    create: forbiddenWrite("create"),
    update: forbiddenWrite("update"),
    deleteMany: forbiddenWrite("deleteMany"),
  };
  const organizationUser = {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    // The membership lifecycle counts what is left after the change; a
    // single-organization person has nothing, which is what escalates the
    // account flag (ADR-094 Decision 4).
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const mock = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    providerIdentityLink: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    organizationUser,
    roleBinding,
    session: {
      // UserService.deactivate (called from SCIM) revokes all sessions —
      // mock the session model so the revocation succeeds with zero rows.
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // Prisma accepts both an array of operations and an interactive
    // callback; the membership lifecycle uses the callback form.
    $transaction: vi
      .fn()
      .mockImplementation((opsOrCallback: unknown) =>
        typeof opsOrCallback === "function"
          ? (opsOrCallback as (tx: unknown) => Promise<unknown>)(mock)
          : Promise.all(opsOrCallback as unknown[]),
      ),
  };
  return mock as unknown as PrismaClient;
}

function buildMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    name: "Alice Smith",
    email: "alice@acme.com",
    emailVerified: false,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    userHashKey: null,
    twoFactorEnabled: false,
    tracesExplorerTourDismissedAt: null,
    passkeyNudgeDismissedAt: null,
    ...overrides,
  };
}

describe("ScimService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ScimService;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.revokeBindings.mockResolvedValue(undefined);
    ledger.offboardMember.mockResolvedValue(undefined);
    prisma = createMockPrisma();
    service = ScimService.create({ prisma });
  });

  describe("toScimUser()", () => {
    describe("when given an active user", () => {
      it("maps to SCIM User format with split name", () => {
        const user = buildMockUser();
        const result = service.toScimUser(user);

        expect(result).toEqual({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          id: "user-1",
          userName: "alice@acme.com",
          name: { givenName: "Alice", familyName: "Smith" },
          emails: [{ primary: true, value: "alice@acme.com", type: "work" }],
          active: true,
          meta: {
            resourceType: "User",
            created: "2024-01-01T00:00:00.000Z",
            lastModified: "2024-01-02T00:00:00.000Z",
          },
        });
      });
    });

    describe("when given a deactivated user", () => {
      it("sets active to false", () => {
        const user = buildMockUser({ deactivatedAt: new Date() });
        const result = service.toScimUser(user);

        expect(result.active).toBe(false);
      });
    });

    describe("when user has a single name without spaces", () => {
      it("uses the full name as givenName with empty familyName", () => {
        const user = buildMockUser({ name: "Alice" });
        const result = service.toScimUser(user);

        expect(result.name).toEqual({ givenName: "Alice", familyName: "" });
      });
    });
  });

  describe("createUser()", () => {
    describe("when the user does not exist", () => {
      it("creates a new user and adds them to the organization", async () => {
        const newUser = buildMockUser();
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
          null,
        );
        (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          newUser,
        );
        (
          prisma.organizationUser.create as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});

        const result = await service.createUser({
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "alice@acme.com",
            name: { givenName: "Alice", familyName: "Smith" },
          },
          organizationId: "org-1",
        });

        expect(result).toHaveProperty("id", "user-1");
        expect(result).toHaveProperty("userName", "alice@acme.com");
        expect(prisma.user.create).toHaveBeenCalledWith({
          data: { name: "Alice Smith", email: "alice@acme.com" },
        });
        expect(prisma.organizationUser.create).toHaveBeenCalledWith({
          data: {
            userId: "user-1",
            organizationId: "org-1",
            role: "MEMBER",
          },
        });
      });
    });

    describe("when the user already exists in the organization", () => {
      it("returns a 409 SCIM error", async () => {
        const existingUser = buildMockUser();
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
          existingUser,
        );
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });

        const result = await service.createUser({
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "alice@acme.com",
          },
          organizationId: "org-1",
        });

        expect(result).toHaveProperty("status", "409");
        expect(result).toHaveProperty(
          "detail",
          "User already exists in this organization",
        );
      });
    });

    describe("when the user exists but not in the organization", () => {
      it("adds them to the organization", async () => {
        const existingUser = buildMockUser();
        (prisma.user.findUnique as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(existingUser) // findByEmail
          .mockResolvedValueOnce(existingUser); // findById reload
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);
        (
          prisma.organizationUser.create as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});

        const result = await service.createUser({
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "alice@acme.com",
          },
          organizationId: "org-2",
        });

        expect(result).toHaveProperty("id", "user-1");
        expect(prisma.organizationUser.create).toHaveBeenCalledWith({
          data: {
            userId: "user-1",
            organizationId: "org-2",
            role: "MEMBER",
          },
        });
      });
    });

    describe("when the membership already exists (P2002 race)", () => {
      it("reconciles the membership grant before returning the user", async () => {
        const existingUser = buildMockUser();
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
          existingUser,
        );
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);
        (
          prisma.organizationUser.create as ReturnType<typeof vi.fn>
        ).mockRejectedValue(
          new PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "7.0.0",
          }),
        );

        const result = await service.createUser({
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "alice@acme.com",
          },
          organizationId: "org-1",
        });

        expect(result).toHaveProperty("id", "user-1");
        expect(prisma.roleBinding.findMany).toHaveBeenCalled();
        expect(ledger.attachBindings).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-1",
            bindings: expect.arrayContaining([
              expect.objectContaining({
                principal: { userId: "user-1" },
                role: "MEMBER",
                scopeType: "ORGANIZATION",
                scopeId: "org-1",
              }),
            ]),
          }),
        );
      });
    });
  });

  describe("getUser()", () => {
    describe("when the user belongs to the organization", () => {
      it("returns the SCIM user", async () => {
        const user = buildMockUser();
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          user,
        });

        const result = await service.getUser({
          id: "user-1",
          organizationId: "org-1",
        });

        expect(result).toHaveProperty("id", "user-1");
        expect(result).toHaveProperty("userName", "alice@acme.com");
      });
    });

    describe("when the user does not belong to the organization", () => {
      it("returns a 404 SCIM error", async () => {
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.getUser({
          id: "user-1",
          organizationId: "org-1",
        });

        expect(result).toHaveProperty("status", "404");
      });
    });
  });

  describe("listUsers()", () => {
    describe("when listing without a filter", () => {
      it("returns all org members in SCIM list format", async () => {
        const user = buildMockUser();
        (
          prisma.organizationUser.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([{ user }]);
        (
          prisma.organizationUser.count as ReturnType<typeof vi.fn>
        ).mockResolvedValue(1);

        const result = await service.listUsers({ organizationId: "org-1" });

        expect(result.schemas).toEqual([
          "urn:ietf:params:scim:api:messages:2.0:ListResponse",
        ]);
        expect(result.totalResults).toBe(1);
        expect(result.Resources).toHaveLength(1);
        expect(result.Resources[0]).toHaveProperty(
          "userName",
          "alice@acme.com",
        );
      });
    });

    describe("when filtering by userName", () => {
      it("passes the email filter to the query", async () => {
        (
          prisma.organizationUser.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([]);
        (
          prisma.organizationUser.count as ReturnType<typeof vi.fn>
        ).mockResolvedValue(0);

        await service.listUsers({
          organizationId: "org-1",
          filter: 'userName eq "alice@acme.com"',
        });

        expect(prisma.organizationUser.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              organizationId: "org-1",
              user: {
                email: { equals: "alice@acme.com", mode: "insensitive" },
              },
            },
          }),
        );
      });
    });
  });

  describe("deleteUser()", () => {
    describe("when the user belongs to the organization", () => {
      it("removes the membership, and deactivates the account only because it was their last", async () => {
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });

        const result = await service.deleteUser({
          id: "user-1",
          organizationId: "org-1",
        });

        expect(result).toBeNull();
        expect(prisma.organizationUser.deleteMany).toHaveBeenCalledWith({
          where: { userId: "user-1", organizationId: "org-1" },
        });
        expect(prisma.user.updateMany).toHaveBeenCalledWith({
          where: { id: "user-1", deactivatedAt: null },
          data: { deactivatedAt: expect.any(Date) },
        });
      });

      it("issues an offboard sweep instead of an id-diff revoke, so a grant the projection hasn't caught up to still gets swept", async () => {
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });
        (
          prisma.roleBinding.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([{ id: "rb-1" }, { id: "rb-2" }]);
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          buildMockUser({ deactivatedAt: new Date() }),
        );

        await service.deleteUser({ id: "user-1", organizationId: "org-1" });

        expect(ledger.offboardMember).toHaveBeenCalledWith({
          organizationId: "org-1",
          userId: "user-1",
          revokedGrantIds: ["rb-1", "rb-2"],
          actor: { type: "system", id: "system:scim" },
        });
      });

      it("leaves the account alone when the person is still active elsewhere", async () => {
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });
        (
          prisma.organizationUser.count as ReturnType<typeof vi.fn>
        ).mockResolvedValue(1);

        await service.deleteUser({ id: "user-1", organizationId: "org-1" });

        expect(prisma.user.updateMany).not.toHaveBeenCalled();
      });
    });

    describe("when the user does not belong to the organization", () => {
      it("returns a 404 SCIM error", async () => {
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.deleteUser({
          id: "user-1",
          organizationId: "org-1",
        });

        expect(result).toHaveProperty("status", "404");
      });
    });
  });

  describe("updateUser()", () => {
    describe("when deactivating via PATCH", () => {
      it("disables the membership in this organization", async () => {
        const user = buildMockUser();
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
          disabledAt: null,
        });
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...user,
          deactivatedAt: new Date(),
        });

        const result = await service.updateUser({
          id: "user-1",
          organizationId: "org-1",
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [{ op: "replace", value: { active: false } }],
          },
        });

        expect(prisma.organizationUser.updateMany).toHaveBeenCalledWith({
          where: {
            userId: "user-1",
            organizationId: "org-1",
            disabledAt: null,
          },
          data: { disabledAt: expect.any(Date) },
        });
        expect(result).toHaveProperty("active", false);
      });
    });
  });

  describe("replaceUser()", () => {
    describe("when replacing with active: false", () => {
      it("disables the membership in this organization", async () => {
        const user = buildMockUser();
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
          disabledAt: null,
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          user,
        );
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...user,
          deactivatedAt: new Date(),
        });

        const result = await service.replaceUser({
          id: "user-1",
          organizationId: "org-1",
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "alice@acme.com",
            name: { givenName: "Alice", familyName: "Smith" },
            active: false,
          },
        });

        expect(result).toHaveProperty("active", false);
      });
    });
  });
});
