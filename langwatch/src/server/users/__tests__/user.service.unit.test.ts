import { describe, expect, it, vi, beforeEach } from "vitest";
import { UserService } from "../user.service";

function createMockPrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as Parameters<typeof UserService.create>[0];
}

describe("UserService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: UserService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = UserService.create(prisma);
  });

  describe("deactivate()", () => {
    describe("when called with a valid user id", () => {
      it("sets deactivatedAt to the current timestamp", async () => {
        const mockUser = { id: "user-1", deactivatedAt: new Date() };
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        const result = await service.deactivate({ id: "user-1" });

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { deactivatedAt: expect.any(Date) },
        });
        expect(result.deactivatedAt).toBeInstanceOf(Date);
      });
    });
  });

  describe("reactivate()", () => {
    describe("when called with a deactivated user", () => {
      it("clears deactivatedAt to null", async () => {
        const mockUser = { id: "user-1", deactivatedAt: null };
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        const result = await service.reactivate({ id: "user-1" });

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { deactivatedAt: null },
        });
        expect(result.deactivatedAt).toBeNull();
      });
    });
  });

  describe("findByEmail()", () => {
    describe("when the email exists", () => {
      it("returns the user", async () => {
        const mockUser = { id: "user-1", email: "alice@acme.com" };
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        const result = await service.findByEmail({ email: "alice@acme.com" });

        expect(result).toEqual(mockUser);
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
          where: { email: "alice@acme.com" },
        });
      });
    });

    describe("when the email does not exist", () => {
      it("returns null", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const result = await service.findByEmail({ email: "unknown@acme.com" });

        expect(result).toBeNull();
      });
    });
  });

  describe("findByExternalId()", () => {
    describe("when the external id exists in the organization", () => {
      it("returns the user", async () => {
        const mockUser = { id: "user-1", externalId: "ext-123" };
        (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        const result = await service.findByExternalId({
          externalId: "ext-123",
          organizationId: "org-1",
        });

        expect(result).toEqual(mockUser);
        expect(prisma.user.findFirst).toHaveBeenCalledWith({
          where: {
            externalId: "ext-123",
            orgMemberships: { some: { organizationId: "org-1" } },
          },
        });
      });
    });
  });

  describe("create()", () => {
    describe("when externalId is provided", () => {
      it("creates user with scimProvisioned true", async () => {
        const mockUser = { id: "user-1", name: "Alice", email: "alice@acme.com", scimProvisioned: true };
        (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        await service.create({ name: "Alice", email: "alice@acme.com", externalId: "ext-1" });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: {
            name: "Alice",
            email: "alice@acme.com",
            externalId: "ext-1",
            scimProvisioned: true,
          },
        });
      });
    });

    describe("when externalId is not provided", () => {
      it("creates user with scimProvisioned false", async () => {
        const mockUser = { id: "user-1", scimProvisioned: false };
        (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        await service.create({ name: "Bob", email: "bob@acme.com" });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: {
            name: "Bob",
            email: "bob@acme.com",
            externalId: undefined,
            scimProvisioned: false,
          },
        });
      });
    });
  });

  describe("setExternalId()", () => {
    describe("when called", () => {
      it("updates externalId and sets scimProvisioned", async () => {
        const mockUser = { id: "user-1", externalId: "ext-new", scimProvisioned: true };
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        await service.setExternalId({ id: "user-1", externalId: "ext-new" });

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { externalId: "ext-new", scimProvisioned: true },
        });
      });
    });
  });
});
