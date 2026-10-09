import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserService } from "../user.service";

// An App carrying no Redis, so the revoke helper deactivate() calls takes its
// Postgres-only path instead of talking to a real Redis from a unit test.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));

/**
 * The delegates the service touches, kept as the typed `vi.fn()`s they are so
 * a test reaches `.mockResolvedValue` without a cast. `createMockPrisma` is
 * the same object worn as the client.
 */
function createMockDelegates() {
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
  };
}

function createMockPrisma(
  delegates: ReturnType<typeof createMockDelegates>,
): Parameters<typeof UserService.create>[0] {
  return delegates as unknown as Parameters<typeof UserService.create>[0];
}

describe("UserService", () => {
  let delegates: ReturnType<typeof createMockDelegates>;
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: UserService;

  beforeEach(() => {
    delegates = createMockDelegates();
    prisma = createMockPrisma(delegates);
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
    const pendingUser = { pendingSsoSetup: true, email: "andrei@acme.com" };
    const acmeWithPin = (ssoProvider: string | null) => ({
      id: "org_1",
      name: "Acme",
      ssoProvider,
    });

    describe("given the flag is not set", () => {
      it("reports not pending without reading accounts", async () => {
        delegates.user.findUnique.mockResolvedValue({
          pendingSsoSetup: false,
          email: "andrei@acme.com",
        });

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
        expect(delegates.account.findMany).not.toHaveBeenCalled();
      });
    });

    describe("given the flag is set and the user holds no sign-in matching the organization's single sign-on", () => {
      it("reports pending", async () => {
        delegates.user.findUnique.mockResolvedValue(pendingUser);
        delegates.organization.findUnique.mockResolvedValue(
          acmeWithPin("auth0"),
        );
        delegates.account.findMany.mockResolvedValue([
          { provider: "credential", providerAccountId: "user-1" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: true });
      });
    });

    describe("given the flag is set and the user already holds a matching sign-in (pin is a provider name)", () => {
      it("reports not pending", async () => {
        delegates.user.findUnique.mockResolvedValue(pendingUser);
        delegates.organization.findUnique.mockResolvedValue(
          acmeWithPin("auth0"),
        );
        delegates.account.findMany.mockResolvedValue([
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
        delegates.user.findUnique.mockResolvedValue(pendingUser);
        delegates.organization.findUnique.mockResolvedValue(
          acmeWithPin("waad|acme-conn"),
        );
        delegates.account.findMany.mockResolvedValue([
          { provider: "auth0", providerAccountId: "waad|acme-conn|user-123" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
      });
    });

    describe("given the user holds several accounts and only the second matches", () => {
      it("reports not pending with exactly one organization lookup", async () => {
        delegates.user.findUnique.mockResolvedValue(pendingUser);
        delegates.organization.findUnique.mockResolvedValue(
          acmeWithPin("auth0"),
        );
        delegates.account.findMany.mockResolvedValue([
          { provider: "credential", providerAccountId: "user-1" },
          { provider: "auth0", providerAccountId: "sub-1" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
        expect(delegates.organization.findUnique).toHaveBeenCalledOnce();
      });
    });

    describe("given the flag is set but the organization has since dropped its single sign-on pin", () => {
      // The stored flag is only ever cleared by a sign-in, so without this a
      // member would be asked to link a provider nobody names any more.
      /** @scenario "A member is not asked to link a sign-in method their organization no longer requires" */
      it("reports not pending, since there is nothing left to link", async () => {
        delegates.user.findUnique.mockResolvedValue(pendingUser);
        delegates.organization.findUnique.mockResolvedValue(acmeWithPin(null));
        delegates.account.findMany.mockResolvedValue([
          { provider: "credential", providerAccountId: "user-1" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
      });
    });

    describe("given the flag is set but no organization claims the user's domain any more", () => {
      it("reports not pending", async () => {
        delegates.user.findUnique.mockResolvedValue(pendingUser);
        delegates.organization.findUnique.mockResolvedValue(null);
        delegates.account.findMany.mockResolvedValue([
          { provider: "credential", providerAccountId: "user-1" },
        ]);

        const result = await service.getSsoStatus({ id: "user-1" });

        expect(result).toEqual({ pendingSsoSetup: false });
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
        expect(delegates.session.deleteMany).not.toHaveBeenCalled();
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

        expect(delegates.session.deleteMany).not.toHaveBeenCalled();
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
        expect(delegates.session.deleteMany).not.toHaveBeenCalled();
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

        expect(delegates.session.deleteMany).toHaveBeenCalledWith({
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
        expect(delegates.session.deleteMany).not.toHaveBeenCalled();
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
