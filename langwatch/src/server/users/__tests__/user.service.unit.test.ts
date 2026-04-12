import { describe, expect, it, vi, beforeEach } from "vitest";
import { UserService } from "../user.service";

// Mock the redis connection so the revoke helper used by deactivate()
// doesn't try to talk to a real Redis from a unit test.
vi.mock("~/server/redis", () => ({ connection: undefined }));

function createMockPrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    session: {
      // UserService.deactivate now also revokes all sessions for the user.
      // Mock the session model so the revocation succeeds with zero rows.
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
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
        expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "alice@acme.com" } });
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

  describe("updateProfile()", () => {
    describe("when only the name changes", () => {
      it("updates the user but does NOT revoke sessions", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          email: "alice@acme.com",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
          id: "user-1",
          name: "Alice New",
          email: "alice@acme.com",
        });

        await service.updateProfile({ id: "user-1", name: "Alice New" });

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { name: "Alice New" },
        });
        // Name-only change: no session revocation
        expect((prisma as any).session.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the email is provided but unchanged", () => {
      it("updates the user but does NOT revoke sessions", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          email: "alice@acme.com",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
          id: "user-1",
          name: "Alice",
          email: "alice@acme.com",
        });

        await service.updateProfile({
          id: "user-1",
          email: "alice@acme.com",
        });

        expect((prisma as any).session.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the email only differs in case (case-only change)", () => {
      it("normalizes to lowercase and does NOT revoke sessions", async () => {
        // Regression for iter-29: updateProfile must lowercase the
        // incoming email the same way BetterAuth does on signup/signin,
        // otherwise a SCIM sync that passes "Alice@Acme.com" for an
        // existing "alice@acme.com" user would trigger an unneeded
        // session revocation + store a mixed-case email that desyncs
        // from BetterAuth's lowercase signin lookup.
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          email: "alice@acme.com",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
          id: "user-1",
          name: "Alice",
          email: "alice@acme.com",
        });

        await service.updateProfile({
          id: "user-1",
          email: "Alice@Acme.com",
        });

        // Email is normalized to lowercase in the DB write
        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { email: "alice@acme.com" },
        });
        // No revocation because it's a case-only change
        expect((prisma as any).session.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the email is actually changed", () => {
      it("revokes all sessions for the user (cache invalidation)", async () => {
        // Regression for iter-27: BetterAuth caches session.user.email
        // in Redis. After an email change (SCIM-driven or otherwise),
        // cached sessions would otherwise keep the stale email for up
        // to 30 days, breaking invite-accept email matching and any
        // UI that displays the current identity.
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          email: "alice-old@acme.com",
        });
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
          id: "user-1",
          name: "Alice",
          email: "alice-new@acme.com",
        });

        await service.updateProfile({
          id: "user-1",
          email: "alice-new@acme.com",
        });

        expect((prisma as any).session.deleteMany).toHaveBeenCalledWith({
          where: { userId: "user-1" },
        });
      });
    });

    describe("when the email is blank after normalization (CodeRabbit)", () => {
      it("throws and does NOT touch the user row or sessions", async () => {
        await expect(
          service.updateProfile({ id: "user-1", email: "   " }),
        ).rejects.toThrow(/blank/i);
        // No write, no revocation.
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect((prisma as any).session.deleteMany).not.toHaveBeenCalled();
      });

      it("also rejects an empty string", async () => {
        await expect(
          service.updateProfile({ id: "user-1", email: "" }),
        ).rejects.toThrow(/blank/i);
        expect(prisma.user.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("create()", () => {
    describe("when called with name and email", () => {
      it("creates the user", async () => {
        const mockUser = { id: "user-1", name: "Alice", email: "alice@acme.com" };
        (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

        const result = await service.create({ name: "Alice", email: "alice@acme.com" });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: { name: "Alice", email: "alice@acme.com" },
        });
        expect(result).toEqual(mockUser);
      });
    });
  });
});
