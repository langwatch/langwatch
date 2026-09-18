// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import type { PrismaClient, User } from "~/generated/prisma/client";

import { ScimService } from "../scim.service";
import { isScimError } from "../scim.types";
import { resourceStore } from "./scim-user-resource.fixture";

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
    findUnique: vi.fn().mockResolvedValue({ role: "MEMBER", disabledAt: null }),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    delete: vi.fn().mockResolvedValue({}),
  };
  const mock = {
    scimUserResource: resourceStore(),
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(buildMockUser()),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organizationUser,
    scimExternalId: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    scimDirectoryUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    roleBinding,
    grant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    session: {
      // A tenant directory must leave shared sessions untouched.
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn().mockImplementation((operation: unknown) => {
      if (typeof operation === "function") return operation(mock);
      if (Array.isArray(operation)) return Promise.all(operation);
      throw new Error("unexpected transaction input");
    }),
  };
  return mock as unknown as PrismaClient;
}

function buildMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    name: "Alice Smith",
    email: "alice@acme.com",
    emailVerified: false,
    signupConfirmationPending: false,
    passkeySignupClaimHash: null,
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
    langyCodeAccessPreference: null,
    joinOfferDismissedDomains: [],
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

  describe("missing organization scope", () => {
    /** @scenario "Missing organization scope never widens a SCIM query" */
    it.each([
      null,
      void 0,
      "",
      "   ",
      false,
      0,
    ])("rejects invalid organization %s before every user operation", async (organizationId) => {
      const input = {
        organizationId,
        id: "user-1",
        request: { schemas: [], userName: "alice@acme.com" },
        patchRequest: { schemas: [], Operations: [] },
      };
      for (const method of [
        "listUsers",
        "getUser",
        "createUser",
        "replaceUser",
        "updateUser",
        "deleteUser",
      ] as const) {
        await expect(
          Reflect.apply(service[method], service, [input]),
        ).rejects.toThrow(ZodError);
      }
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.organizationUser.findUnique).not.toHaveBeenCalled();
      expect(prisma.scimUserResource.findUnique).not.toHaveBeenCalled();
      expect(prisma.scimUserResource.findFirst).not.toHaveBeenCalled();
    });
  });

  it("maps a raced username uniqueness conflict to SCIM 409", async () => {
    vi.mocked(prisma.scimUserResource.upsert).mockRejectedValue(
      new PrismaClientKnownRequestError("duplicate directory username", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await expect(
      service.replaceUser({
        organizationId: "org-1",
        id: "user-1",
        request: { schemas: [], userName: "alice@acme.com", active: true },
      }),
    ).resolves.toMatchObject({ status: "409", scimType: "uniqueness" });
    expect(prisma.user.update).not.toHaveBeenCalled();
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
        expect(prisma.grant.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              organizationId: "org-1",
              principalType: "USER",
              principalId: "user-1",
            }),
          }),
        );
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
        (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { ...user, scimUserResources: [] },
        ]);
        (prisma.user.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

        const result = await service.listUsers({ organizationId: "org-1" });
        if (isScimError(result)) throw new Error("unexpected refusal");

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
        (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
          [],
        );
        (prisma.user.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

        await service.listUsers({
          organizationId: "org-1",
          filter: 'userName eq "alice@acme.com"',
        });

        expect(prisma.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              AND: [
                {
                  OR: [
                    {
                      scimUserResources: {
                        some: {
                          organizationId: "org-1",
                          userName: {
                            equals: "alice@acme.com",
                            mode: "insensitive",
                          },
                        },
                      },
                    },
                    {
                      scimUserResources: { none: { organizationId: "org-1" } },
                      email: { equals: "alice@acme.com", mode: "insensitive" },
                    },
                  ],
                },
              ],
            }),
          }),
        );
      });
    });
  });

  describe("deleteUser()", () => {
    describe("when the user belongs to the organization", () => {
      it("deletes the tenant resource without deactivating the shared user", async () => {
        const user = buildMockUser();
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...user,
          deactivatedAt: new Date(),
        });

        const result = await service.deleteUser({
          id: "user-1",
          organizationId: "org-1",
        });

        expect(result).toBeNull();
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.scimUserResource.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: { active: false, deletedAt: expect.any(Date) },
          }),
        );
      });

      it("revokes the canonical grants for the departed member", async () => {
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          buildMockUser({ deactivatedAt: new Date() }),
        );

        await service.deleteUser({ id: "user-1", organizationId: "org-1" });

        expect(ledger.revokeBindingsWhere).toHaveBeenCalledWith({
          organizationId: "org-1",
          where: { userId: "user-1" },
          actor: { type: "system", id: "system:scim" },
          reason: "offboarded by the identity provider",
        });
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
      it("calls deactivate on the user", async () => {
        const user = buildMockUser();
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...user,
          deactivatedAt: new Date(),
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

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.scimUserResource.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ active: false }),
          }),
        );
        expect(result).toHaveProperty("active", false);
      });
    });
  });

  describe("replaceUser()", () => {
    describe("when replacing with active: false", () => {
      it("deactivates the user", async () => {
        const user = buildMockUser();
        (
          prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(user) // updateProfile
          .mockResolvedValueOnce({ ...user, deactivatedAt: new Date() }); // deactivate
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
