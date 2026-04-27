import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  afterAccountCreate,
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  beforeAccountCreate,
  beforeSessionCreate,
  beforeUserCreate,
} from "../hooks";

type PrismaMockTable = Record<string, ReturnType<typeof vi.fn>>;
type PrismaMockOverrides = Record<string, PrismaMockTable | unknown>;

const makePrismaMock = (overrides: PrismaMockOverrides = {}): PrismaClient => {
  const base: PrismaMockOverrides = {
    organization: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationInvite: { findFirst: vi.fn().mockResolvedValue(null) },
    organizationUser: {
      create: vi.fn().mockResolvedValue(undefined),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    roleBinding: {
      create: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    account: {
      deleteMany: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const merged: PrismaMockOverrides = { ...base, ...overrides };
  // Support both $transaction forms: array form (returns the ops) and
  // callback form (invokes the callback with this same mock as `tx`, so
  // tests continue to assert against `prisma.xxx` spies).
  if (!merged.$transaction) {
    merged.$transaction = vi.fn().mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => unknown)(merged);
      }
      return arg;
    });
  }
  return merged as unknown as PrismaClient;
};

describe("beforeUserCreate", () => {
  describe("when the user is deactivated", () => {
    it("blocks the creation by returning false", async () => {
      const prisma = makePrismaMock();
      const result = await beforeUserCreate({
        prisma,
        user: { email: "u@x.com", deactivatedAt: new Date("2020-01-01") },
      });
      expect(result).toBe(false);
    });
  });

  describe("when the user is active", () => {
    it("does not block and returns void", async () => {
      const prisma = makePrismaMock();
      const result = await beforeUserCreate({
        prisma,
        user: { email: "u@x.com" },
      });
      expect(result).toBeUndefined();
    });
  });
});

describe("afterUserCreate", () => {
  describe("when the email domain matches an organization with ssoDomain", () => {
    it("adds the user to the organization as a MEMBER", async () => {
      const prisma = makePrismaMock({
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
          }),
        },
        organizationUser: {
          create: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      await afterUserCreate({
        prisma,
        user: { id: "user_1", email: "new@acme.com" },
      });

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { ssoDomain: "acme.com" },
      });
      expect(prisma.organizationUser.create).toHaveBeenCalledWith({
        data: { userId: "user_1", organizationId: "org_1", role: "MEMBER" },
      });
    });
  });

  describe("when a PENDING invite exists for the signing-up user", () => {
    it("applies the invite's role + team assignments and marks it ACCEPTED", async () => {
      const pendingInvite = {
        id: "inv_1",
        email: "Alice@Acme.com",
        organizationId: "org_1",
        role: "ADMIN",
        teamIds: "",
        teamAssignments: [
          { teamId: "team_1", role: "ADMIN" },
          { teamId: "team_2", role: "MEMBER", customRoleId: "cr_1" },
        ],
        status: "PENDING",
      };

      const inviteUpdate = vi.fn().mockResolvedValue(undefined);
      const orgUserCreateMany = vi.fn().mockResolvedValue({ count: 1 });
      const roleBindingCreate = vi.fn().mockResolvedValue(undefined);
      const roleBindingDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

      const prisma = makePrismaMock({
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
          }),
        },
        organizationInvite: {
          findFirst: vi.fn().mockResolvedValue(pendingInvite),
          update: inviteUpdate,
        },
        organizationUser: {
          create: vi.fn(),
          createMany: orgUserCreateMany,
          count: vi.fn().mockResolvedValue(0),
        },
        roleBinding: {
          create: roleBindingCreate,
          deleteMany: roleBindingDeleteMany,
        },
      });

      await afterUserCreate({
        prisma,
        user: { id: "user_1", email: "alice@acme.com" },
      });

      // Default-branch create must NOT run when invite is applied.
      expect(prisma.organizationUser.create).not.toHaveBeenCalled();

      // OrganizationUser written via invite application (ADMIN role from invite).
      expect(orgUserCreateMany).toHaveBeenCalledWith({
        data: [
          {
            userId: "user_1",
            organizationId: "org_1",
            role: "ADMIN",
          },
        ],
        skipDuplicates: true,
      });

      // 3 RoleBinding creates: 1 ORG-scope (ADMIN) + 2 TEAM-scope.
      expect(roleBindingCreate).toHaveBeenCalledTimes(3);

      // Invite flipped to ACCEPTED so the link stops looking outstanding.
      expect(inviteUpdate).toHaveBeenCalledWith({
        where: { id: "inv_1", organizationId: "org_1" },
        data: { status: "ACCEPTED" },
      });
    });
  });

  describe("when the email domain does not match any SSO organization", () => {
    it("does nothing", async () => {
      const prisma = makePrismaMock();
      await afterUserCreate({
        prisma,
        user: { id: "user_1", email: "u@other.com" },
      });
      expect(prisma.organizationUser.create).not.toHaveBeenCalled();
    });
  });

  describe("when the user has no email", () => {
    it("does nothing and does not throw", async () => {
      const prisma = makePrismaMock();
      await afterUserCreate({
        prisma,
        user: { id: "user_1", email: "" },
      });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("when the org auto-add fails (concurrent signup race / db error)", () => {
    it("swallows the error so the signup itself still succeeds", async () => {
      // Regression for iter-23: throwing in afterUserCreate would propagate
      // up through BetterAuth's pendingHooks loop and bubble out of
      // handleOAuthUserInfo as `unable to create user`. The User row is
      // already committed at this point — failing the signup would orphan
      // the user. Best-effort: log and swallow.
      const prisma = makePrismaMock({
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
          }),
        },
        organizationUser: {
          create: vi
            .fn()
            .mockRejectedValue(new Error("P2002 unique constraint")),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      await expect(
        afterUserCreate({
          prisma,
          user: { id: "user_1", email: "u@acme.com" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("beforeAccountCreate", () => {
  describe("when the user does not exist", () => {
    it("does nothing", async () => {
      const prisma = makePrismaMock();
      await beforeAccountCreate({
        prisma,
        account: { userId: "user_x", providerId: "google", accountId: "sub-1" },
      });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("when the user is deactivated", () => {
    it("throws USER_DEACTIVATED", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "u@acme.com",
            deactivatedAt: new Date("2020-01-01"),
          }),
          update: vi.fn(),
        },
      });
      await expect(
        beforeAccountCreate({
          prisma,
          account: { userId: "user_1", providerId: "google", accountId: "sub-1" },
        }),
      ).rejects.toThrow("USER_DEACTIVATED");
    });
  });

  describe("when the user's email domain matches an org with correct SSO provider", () => {
    it("defers reconciliation to afterAccountCreate (no DB writes in before)", async () => {
      const deleteMany = vi.fn();
      const update = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "existing@acme.com",
            deactivatedAt: null,
          }),
          update,
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "google",
          }),
        },
        account: { deleteMany },
        $transaction: vi.fn(),
      });

      await beforeAccountCreate({
        prisma,
        account: { userId: "user_1", providerId: "google", accountId: "sub-1" },
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when an EXISTING user's email domain matches an org with WRONG SSO provider", () => {
    it("soft-blocks by setting pendingSsoSetup=true without throwing", async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "existing@acme.com",
            deactivatedAt: null,
          }),
          update,
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "okta",
          }),
        },
        account: {
          deleteMany: vi.fn(),
          // Existing user — already has a linked account from a prior login.
          count: vi.fn().mockResolvedValue(1),
        },
      });

      await beforeAccountCreate({
        prisma,
        account: { userId: "user_1", providerId: "google", accountId: "sub-1" },
      });

      expect(update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { pendingSsoSetup: true },
      });
    });
  });

  describe("when a NEW user's email domain matches an SSO-enforced org with WRONG provider", () => {
    it("hard-blocks by throwing SSO_PROVIDER_NOT_ALLOWED", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "newsignup@acme.com",
            deactivatedAt: null,
          }),
          update: vi.fn(),
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "okta",
          }),
        },
        account: {
          deleteMany: vi.fn(),
          // No existing accounts → this is a first-time signup.
          count: vi.fn().mockResolvedValue(0),
        },
      });

      await expect(
        beforeAccountCreate({
          prisma,
          account: {
            userId: "user_1",
            providerId: "google",
            accountId: "sub-1",
          },
        }),
      ).rejects.toThrow("SSO_PROVIDER_NOT_ALLOWED");
    });
  });

  describe("when a NEW user's email domain matches an SSO-enforced org and provider is credential (on-prem)", () => {
    it("does NOT hard-block (credentials exempt — on-prem email mode)", async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "onprem@acme.com",
            deactivatedAt: null,
          }),
          update,
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "okta",
          }),
        },
        account: {
          deleteMany: vi.fn(),
          count: vi.fn().mockResolvedValue(0),
        },
      });

      await expect(
        beforeAccountCreate({
          prisma,
          account: {
            userId: "user_1",
            providerId: "credential",
            accountId: "onprem@acme.com",
          },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the email domain does not match any SSO org", () => {
    it("does nothing (normal account creation flow)", async () => {
      const update = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "u@unrelated.com",
            deactivatedAt: null,
          }),
          update,
        },
      });

      await beforeAccountCreate({
        prisma,
        account: { userId: "user_1", providerId: "google", accountId: "sub-1" },
      });

      expect(update).not.toHaveBeenCalled();
    });
  });
});

describe("afterAccountCreate", () => {
  describe("when the new account is the credential provider", () => {
    it("does nothing (on-prem email-mode path)", async () => {
      const deleteMany = vi.fn();
      const prisma = makePrismaMock({
        user: { findUnique: vi.fn(), update: vi.fn() },
        account: { deleteMany, count: vi.fn() },
      });

      await afterAccountCreate({
        prisma,
        account: {
          userId: "user_1",
          providerId: "credential",
          accountId: "u@acme.com",
        },
      });

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when the user's email domain matches an org with the correct SSO provider", () => {
    it("clears pendingSsoSetup and removes stale OAuth accounts", async () => {
      const deleteMany = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockResolvedValue(undefined);
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "existing@acme.com",
          }),
          update,
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "auth0",
          }),
        },
        account: { deleteMany },
        $transaction: vi.fn().mockImplementation(async (ops: unknown[]) => ops),
      });

      await afterAccountCreate({
        prisma,
        account: {
          userId: "user_1",
          providerId: "auth0",
          accountId: "auth0|sub-1",
        },
      });

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "user_1",
          provider: { not: "credential" },
          OR: [
            { provider: { not: "auth0" } },
            { providerAccountId: { not: "auth0|sub-1" } },
          ],
        },
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { pendingSsoSetup: false },
      });
    });
  });

  describe("when the provider does not match the org's configured SSO", () => {
    it("does not reconcile (leaves state for beforeAccountCreate to flag)", async () => {
      const deleteMany = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "existing@acme.com",
          }),
          update: vi.fn(),
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "okta",
          }),
        },
        account: { deleteMany },
      });

      await afterAccountCreate({
        prisma,
        account: { userId: "user_1", providerId: "google", accountId: "sub-1" },
      });

      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when the email domain does not match any SSO org", () => {
    it("does nothing", async () => {
      const deleteMany = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "u@unrelated.com",
          }),
          update: vi.fn(),
        },
        account: { deleteMany },
      });

      await afterAccountCreate({
        prisma,
        account: { userId: "user_1", providerId: "google", accountId: "sub-1" },
      });

      expect(deleteMany).not.toHaveBeenCalled();
    });
  });
});

describe("beforeSessionCreate", () => {
  describe("when the user is deactivated", () => {
    it("blocks the session", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            deactivatedAt: new Date("2020-01-01"),
          }),
          update: vi.fn(),
        },
      });
      const result = await beforeSessionCreate({
        prisma,
        session: { userId: "user_1" },
      });
      expect(result).toBe(false);
    });
  });

  describe("when the user is active", () => {
    it("allows the session", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({ deactivatedAt: null }),
          update: vi.fn(),
        },
      });
      const result = await beforeSessionCreate({
        prisma,
        session: { userId: "user_1" },
      });
      expect(result).toBeUndefined();
    });
  });
});

describe("afterSessionCreate", () => {
  describe("when the user has an organization", () => {
    it("fires nurturing hooks with hasOrganization=true", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            _count: { orgMemberships: 1 },
          }),
          update: vi.fn().mockResolvedValue(undefined),
        },
      });
      const fireActivityTrackingNurturing = vi.fn();
      const ensureUserSyncedToCio = vi.fn();

      await afterSessionCreate({
        prisma,
        userId: "user_1",
        fireActivityTrackingNurturing,
        ensureUserSyncedToCio,
      });

      // Fire-and-forget — give the chained .then() a microtask to run
      await new Promise((r) => setImmediate(r));

      expect(fireActivityTrackingNurturing).toHaveBeenCalledWith({
        userId: "user_1",
        hasOrganization: true,
      });
      expect(ensureUserSyncedToCio).toHaveBeenCalledWith({
        userId: "user_1",
        hasOrganization: true,
      });
    });
  });

  describe("when the user has no organization", () => {
    it("fires nurturing hooks with hasOrganization=false", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            _count: { orgMemberships: 0 },
          }),
          update: vi.fn().mockResolvedValue(undefined),
        },
      });
      const fireActivityTrackingNurturing = vi.fn();
      const ensureUserSyncedToCio = vi.fn();

      await afterSessionCreate({
        prisma,
        userId: "user_1",
        fireActivityTrackingNurturing,
        ensureUserSyncedToCio,
      });

      await new Promise((r) => setImmediate(r));

      expect(fireActivityTrackingNurturing).toHaveBeenCalledWith({
        userId: "user_1",
        hasOrganization: false,
      });
    });
  });

  describe("when the session is NOT an impersonation session", () => {
    it("updates User.lastLoginAt to now", async () => {
      const userUpdate = vi.fn().mockResolvedValue(undefined);
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            _count: { orgMemberships: 0 },
          }),
          update: userUpdate,
        },
      });

      await afterSessionCreate({
        prisma,
        userId: "user_1",
        fireActivityTrackingNurturing: vi.fn(),
        ensureUserSyncedToCio: vi.fn(),
      });

      expect(userUpdate).toHaveBeenCalledTimes(1);
      const call = userUpdate.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { lastLoginAt: Date };
      };
      expect(call.where).toEqual({ id: "user_1" });
      expect(call.data.lastLoginAt).toBeInstanceOf(Date);
      // Should be very recent
      const delta = Date.now() - call.data.lastLoginAt.getTime();
      expect(delta).toBeLessThan(5000);
    });
  });

  describe("when the session IS an impersonation session", () => {
    it("does NOT update lastLoginAt (admin's activity shouldn't ghost-write target user)", async () => {
      const userUpdate = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            _count: { orgMemberships: 1 },
          }),
          update: userUpdate,
        },
      });

      await afterSessionCreate({
        prisma,
        userId: "user_target",
        isImpersonationSession: true,
        fireActivityTrackingNurturing: vi.fn(),
        ensureUserSyncedToCio: vi.fn(),
      });

      expect(userUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when the lastLoginAt update fails", () => {
    it("does not throw (logged and swallowed)", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            _count: { orgMemberships: 0 },
          }),
          update: vi.fn().mockRejectedValue(new Error("db down")),
        },
      });

      await expect(
        afterSessionCreate({
          prisma,
          userId: "user_1",
          fireActivityTrackingNurturing: vi.fn(),
          ensureUserSyncedToCio: vi.fn(),
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("afterAccountUpdate", () => {
  describe("when the user has pendingSsoSetup=true and the updated account matches the org's SSO provider", () => {
    it("clears pendingSsoSetup and deletes stale non-credential accounts", async () => {
      const deleteMany = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockResolvedValue(undefined);
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "existing@acme.com",
            pendingSsoSetup: true,
          }),
          update,
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "auth0",
          }),
        },
        account: { deleteMany },
        $transaction: vi.fn().mockImplementation(async (ops: unknown[]) => ops),
      });

      await afterAccountUpdate({
        prisma,
        account: {
          userId: "user_1",
          providerId: "auth0",
          accountId: "auth0|sub-1",
        },
      });

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "user_1",
          provider: { not: "credential" },
          OR: [
            { provider: { not: "auth0" } },
            { providerAccountId: { not: "auth0|sub-1" } },
          ],
        },
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "user_1" },
        data: { pendingSsoSetup: false },
      });
    });
  });

  describe("when the user does not have pendingSsoSetup set", () => {
    it("is a no-op (does not touch accounts or user)", async () => {
      const deleteMany = vi.fn();
      const update = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "existing@acme.com",
            pendingSsoSetup: false,
          }),
          update,
        },
        account: { deleteMany },
      });

      await afterAccountUpdate({
        prisma,
        account: {
          userId: "user_1",
          providerId: "auth0",
          accountId: "auth0|sub-1",
        },
      });

      expect(deleteMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the updated account does NOT match the org's SSO provider", () => {
    it("is a no-op (we do not clear the flag on wrong-provider sign-in)", async () => {
      const deleteMany = vi.fn();
      const update = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "existing@acme.com",
            pendingSsoSetup: true,
          }),
          update,
        },
        organization: {
          findUnique: vi.fn().mockResolvedValue({
            id: "org_1",
            ssoDomain: "acme.com",
            ssoProvider: "auth0",
          }),
        },
        account: { deleteMany },
      });

      await afterAccountUpdate({
        prisma,
        account: {
          userId: "user_1",
          providerId: "google",
          accountId: "google-sub-1",
        },
      });

      expect(deleteMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the user's email domain does not match any SSO org", () => {
    it("is a no-op", async () => {
      const deleteMany = vi.fn();
      const update = vi.fn();
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_1",
            email: "user@personal.com",
            pendingSsoSetup: true,
          }),
          update,
        },
        organization: { findUnique: vi.fn().mockResolvedValue(null) },
        account: { deleteMany },
      });

      await afterAccountUpdate({
        prisma,
        account: {
          userId: "user_1",
          providerId: "auth0",
          accountId: "auth0|sub-1",
        },
      });

      expect(deleteMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when reconciliation throws", () => {
    it("does not throw (logged and swallowed)", async () => {
      const prisma = makePrismaMock({
        user: {
          findUnique: vi.fn().mockRejectedValue(new Error("db down")),
        },
      });

      await expect(
        afterAccountUpdate({
          prisma,
          account: {
            userId: "user_1",
            providerId: "auth0",
            accountId: "auth0|sub-1",
          },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
