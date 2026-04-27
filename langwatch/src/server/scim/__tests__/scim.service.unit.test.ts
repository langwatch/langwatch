import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScimService } from "../scim.service";
import type { User } from "@prisma/client";

// Mock the redis connection so the revoke helper used by deactivate()
// (transitively reachable from SCIM deactivation paths) doesn't try to
// talk to a real Redis from a unit test.
vi.mock("~/server/redis", () => ({ connection: undefined }));

function createMockPrisma() {
  const roleBinding = {
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({}),
  };
  const organizationUser = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    delete: vi.fn().mockResolvedValue({}),
  };
  const mock = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organizationUser,
    roleBinding,
    session: {
      // UserService.deactivate (called from SCIM) revokes all sessions —
      // mock the session model so the revocation succeeds with zero rows.
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
  return mock as unknown as Parameters<typeof ScimService.create>[0];
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
    ...overrides,
  };
}

describe("ScimService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ScimService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = ScimService.create(prisma);
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
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(newUser);
        (prisma.organizationUser.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

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
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(existingUser);
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
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
        expect(result).toHaveProperty("detail", "User already exists in this organization");
      });
    });

    describe("when the user exists but not in the organization", () => {
      it("adds them to the organization", async () => {
        const existingUser = buildMockUser();
        (prisma.user.findUnique as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(existingUser) // findByEmail
          .mockResolvedValueOnce(existingUser); // findById reload
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (prisma.organizationUser.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

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
  });

  describe("getUser()", () => {
    describe("when the user belongs to the organization", () => {
      it("returns the SCIM user", async () => {
        const user = buildMockUser();
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          user,
        });

        const result = await service.getUser({ id: "user-1", organizationId: "org-1" });

        expect(result).toHaveProperty("id", "user-1");
        expect(result).toHaveProperty("userName", "alice@acme.com");
      });
    });

    describe("when the user does not belong to the organization", () => {
      it("returns a 404 SCIM error", async () => {
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await service.getUser({ id: "user-1", organizationId: "org-1" });

        expect(result).toHaveProperty("status", "404");
      });
    });
  });

  describe("listUsers()", () => {
    describe("when listing without a filter", () => {
      it("returns all org members in SCIM list format", async () => {
        const user = buildMockUser();
        (prisma.organizationUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { user },
        ]);
        (prisma.organizationUser.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

        const result = await service.listUsers({ organizationId: "org-1" });

        expect(result.schemas).toEqual([
          "urn:ietf:params:scim:api:messages:2.0:ListResponse",
        ]);
        expect(result.totalResults).toBe(1);
        expect(result.Resources).toHaveLength(1);
        expect(result.Resources[0]).toHaveProperty("userName", "alice@acme.com");
      });
    });

    describe("when filtering by userName", () => {
      it("passes the email filter to the query", async () => {
        (prisma.organizationUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        (prisma.organizationUser.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

        await service.listUsers({
          organizationId: "org-1",
          filter: 'userName eq "alice@acme.com"',
        });

        expect(prisma.organizationUser.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              organizationId: "org-1",
              user: { email: { equals: "alice@acme.com", mode: "insensitive" } },
            },
          })
        );
      });
    });
  });

  describe("deleteUser()", () => {
    describe("when the user belongs to the organization", () => {
      it("deactivates the user (soft delete)", async () => {
        const user = buildMockUser();
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
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
        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { deactivatedAt: expect.any(Date) },
        });
      });
    });

    describe("when the user does not belong to the organization", () => {
      it("returns a 404 SCIM error", async () => {
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

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
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
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

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { deactivatedAt: expect.any(Date) },
        });
        expect(result).toHaveProperty("active", false);
      });
    });
  });

  describe("replaceUser()", () => {
    describe("when replacing with active: false", () => {
      it("deactivates the user", async () => {
        const user = buildMockUser();
        (prisma.organizationUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
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
