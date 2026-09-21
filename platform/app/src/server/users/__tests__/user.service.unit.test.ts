import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserService } from "../user.service";

// An App carrying no Redis, so the revoke helper deactivate() calls takes its
// Postgres-only path instead of talking to a real Redis from a unit test.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

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
    organization: {
      // Backs the default PrismaLegacySsoOrganizationRepository getSsoStatus()
      // reads through.
      findUnique: vi.fn().mockResolvedValue(null),
    },
    account: {
      findMany: vi.fn().mockResolvedValue([]),
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

  describe("create()", () => {
    it("persists an explicitly inactive account inactive from the first write", async () => {
      await service.create({
        name: "Inactive person",
        email: "inactive@example.com",
        active: false,
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          name: "Inactive person",
          email: "inactive@example.com",
          deactivatedAt: expect.any(Date),
        },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("preserves active creation when no status is supplied", async () => {
      await service.create({
        name: "Active person",
        email: "active@example.com",
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { name: "Active person", email: "active@example.com" },
      });
    });
  });

  describe("deactivate()", () => {
    describe("when called with a valid user id", () => {
      it("sets deactivatedAt to the current timestamp", async () => {
        const mockUser = { id: "user-1", deactivatedAt: new Date() };
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockUser,
        );

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
        (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockUser,
        );

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
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockUser,
        );

        const result = await service.findByEmail({ email: "alice@acme.com" });

        expect(result).toEqual(mockUser);
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
          where: { email: "alice@acme.com" },
        });
      });
    });

    describe("when the email does not exist", () => {
      it("returns null", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
          null,
        );

        const result = await service.findByEmail({ email: "unknown@acme.com" });

        expect(result).toBeNull();
      });
    });
  });

  describe("getSsoStatus()", () => {
    describe("given the flag is not set", () => {
      it("reports not pending without reading accounts", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          pendingSsoSetup: false,
          email: "andrei@acme.com",
        });

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
        expect((prisma as any).account.findMany).not.toHaveBeenCalled();
      });
    });

    describe("given the flag is set and the user holds no sign-in matching the organization's single sign-on", () => {
      it("reports pending", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          pendingSsoSetup: true,
          email: "andrei@acme.com",
        });
        (
          (prisma as any).organization.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "org_1",
          name: "Acme",
          ssoProvider: "auth0",
        });
        (
          (prisma as any).account.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([
          { provider: "credential", providerAccountId: "user-1" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: true });
      });
    });

    describe("given the flag is set and the user already holds a matching sign-in (pin is a provider name)", () => {
      it("reports not pending", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          pendingSsoSetup: true,
          email: "andrei@acme.com",
        });
        (
          (prisma as any).organization.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "org_1",
          name: "Acme",
          ssoProvider: "auth0",
        });
        (
          (prisma as any).account.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([
          { provider: "auth0", providerAccountId: "sub-1" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
      });
    });

    describe("given the flag is set and the pin is a providerAccountId prefix that the user's account id starts with", () => {
      // The trap: comparing the pin to the account by equality would miss
      // this — the pin is only a PREFIX of the account's id.
      it("reports not pending", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          pendingSsoSetup: true,
          email: "andrei@acme.com",
        });
        (
          (prisma as any).organization.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "org_1",
          name: "Acme",
          ssoProvider: "waad|acme-conn",
        });
        (
          (prisma as any).account.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([
          { provider: "auth0", providerAccountId: "waad|acme-conn|user-123" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
      });
    });

    describe("given the user holds several accounts and only the second matches", () => {
      it("reports not pending with exactly one organization lookup", async () => {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          pendingSsoSetup: true,
          email: "andrei@acme.com",
        });
        (
          (prisma as any).organization.findUnique as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "org_1",
          name: "Acme",
          ssoProvider: "auth0",
        });
        (
          (prisma as any).account.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([
          { provider: "credential", providerAccountId: "user-1" },
          { provider: "auth0", providerAccountId: "sub-1" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
        expect((prisma as any).organization.findUnique).toHaveBeenCalledOnce();
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
        const mockUser = {
          id: "user-1",
          name: "Alice",
          email: "alice@acme.com",
        };
        (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockUser,
        );

        const result = await service.create({
          name: "Alice",
          email: "alice@acme.com",
        });

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: { name: "Alice", email: "alice@acme.com" },
        });
        expect(result).toEqual(mockUser);
      });
    });
  });
});
