import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    organization: { findFirst: vi.fn() },
    session: { findUnique: vi.fn() },
    account: {
      create: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
    organizationUser: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../injection/dependencies.server", () => ({
  dependencies: {},
}));

vi.mock("../../utils/auth", () => ({
  getNextAuthSessionToken: vi.fn().mockReturnValue(null),
}));

vi.mock("../../utils/logger/server", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../../../ee/billing/nurturing/hooks/activityTracking", () => ({
  fireActivityTrackingNurturing: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    NEXTAUTH_PROVIDER: "auth0",
  },
}));

import { prisma } from "~/server/db";
import { authOptions } from "../auth";

const prismaMock = prisma as any;

const ssoOrg = {
  id: "org-1",
  name: "SSO Corp",
  ssoDomain: "sso-corp.com",
  ssoProvider: "waad|sso-corp-connection",
};

const existingUser = {
  id: "user-1",
  email: "alice@sso-corp.com",
  deactivatedAt: null,
};

const ssoAccount = {
  provider: "auth0",
  type: "oauth",
  providerAccountId: "waad|sso-corp-connection|uuid-123",
  access_token: "tok",
  refresh_token: "ref",
  expires_at: 9999,
  token_type: "Bearer",
  scope: "openid",
  id_token: "id-tok",
};

const nonSsoAccount = {
  provider: "auth0",
  type: "oauth",
  providerAccountId: "google-oauth2|old-google-id",
  access_token: "tok",
  refresh_token: null,
  expires_at: 9999,
  token_type: "Bearer",
  scope: "openid",
  id_token: "id-tok",
};

describe("NextAuth signIn callback – SSO flow", () => {
  let signInCallback: (params: {
    user: any;
    account: any;
  }) => Promise<boolean | string>;

  beforeEach(() => {
    vi.clearAllMocks();

    const options = authOptions({} as any);
    signInCallback = options.callbacks!.signIn! as any;

    prismaMock.$transaction.mockImplementation((ops: any[]) =>
      Promise.all(ops),
    );
  });

  describe("when existing user signs in with correct SSO provider", () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(existingUser);
      prismaMock.organization.findFirst.mockResolvedValue(ssoOrg);
      prismaMock.account.upsert.mockResolvedValue({});
      prismaMock.account.deleteMany.mockResolvedValue({ count: 0 });
    });

    it("auto-links the account and allows sign-in", async () => {
      const result = await signInCallback({
        user: { id: "user-1", email: "alice@sso-corp.com" },
        account: ssoAccount,
      });

      expect(result).toBe(true);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("upserts the account with correct provider details", async () => {
      await signInCallback({
        user: { id: "user-1", email: "alice@sso-corp.com" },
        account: ssoAccount,
      });

      const transactionArgs = prismaMock.$transaction.mock.calls[0]![0];
      expect(prismaMock.account.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_providerAccountId: {
              provider: "auth0",
              providerAccountId: "waad|sso-corp-connection|uuid-123",
            },
          },
          create: expect.objectContaining({
            userId: "user-1",
            provider: "auth0",
            providerAccountId: "waad|sso-corp-connection|uuid-123",
          }),
        }),
      );
    });

    it("removes old auth methods for the same provider", async () => {
      await signInCallback({
        user: { id: "user-1", email: "alice@sso-corp.com" },
        account: ssoAccount,
      });

      expect(prismaMock.account.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          provider: "auth0",
          providerAccountId: {
            not: "waad|sso-corp-connection|uuid-123",
          },
        },
      });
    });
  });

  describe("when existing user signs in with wrong provider (old method)", () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(existingUser);
      prismaMock.organization.findFirst.mockResolvedValue(ssoOrg);
    });

    it("throws SSO_PROVIDER_NOT_ALLOWED", async () => {
      await expect(
        signInCallback({
          user: { id: "user-1", email: "alice@sso-corp.com" },
          account: nonSsoAccount,
        }),
      ).rejects.toThrow("SSO_PROVIDER_NOT_ALLOWED");
    });

    it("does not attempt to link any account", async () => {
      try {
        await signInCallback({
          user: { id: "user-1", email: "alice@sso-corp.com" },
          account: nonSsoAccount,
        });
      } catch {
        // expected
      }

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("when new user signs in with matching SSO domain", () => {
    const newSsoUser = { id: "new-sso", email: "bob@sso-corp.com" };

    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.organization.findFirst.mockResolvedValue(ssoOrg);
      prismaMock.user.create.mockResolvedValue({
        id: "new-user-id",
        email: "bob@sso-corp.com",
      });
      prismaMock.account.create.mockResolvedValue({});
      prismaMock.organizationUser.create.mockResolvedValue({});
    });

    it("creates the user and adds them to the org", async () => {
      const result = await signInCallback({
        user: newSsoUser,
        account: ssoAccount,
      });

      expect(result).toBe(true);
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: "bob@sso-corp.com",
        }),
      });
      expect(prismaMock.organizationUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          role: "MEMBER",
        }),
      });
    });

    it("links the SSO account to the new user", async () => {
      await signInCallback({
        user: newSsoUser,
        account: ssoAccount,
      });

      expect(prismaMock.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: "auth0",
          providerAccountId: "waad|sso-corp-connection|uuid-123",
        }),
      });
    });
  });

  describe("when new user signs in with wrong provider for SSO domain", () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.organization.findFirst.mockResolvedValue(ssoOrg);
    });

    it("throws SSO_PROVIDER_NOT_ALLOWED", async () => {
      await expect(
        signInCallback({
          user: { id: "new", email: "charlie@sso-corp.com" },
          account: nonSsoAccount,
        }),
      ).rejects.toThrow("SSO_PROVIDER_NOT_ALLOWED");
    });
  });

  describe("when user signs in with no SSO domain configured", () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-99",
        email: "dave@regular.com",
        deactivatedAt: null,
      });
      prismaMock.organization.findFirst.mockResolvedValue(null);
    });

    it("allows sign-in without any SSO checks", async () => {
      const result = await signInCallback({
        user: { id: "user-99", email: "dave@regular.com" },
        account: { provider: "auth0", providerAccountId: "google-oauth2|xyz" },
      });

      expect(result).toBe(true);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("when existing user signs in via SSO on subsequent login", () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue(existingUser);
      prismaMock.organization.findFirst.mockResolvedValue(ssoOrg);
      prismaMock.account.upsert.mockResolvedValue({});
      prismaMock.account.deleteMany.mockResolvedValue({ count: 0 });
    });

    it("upsert is idempotent — no errors on repeat login", async () => {
      const result1 = await signInCallback({
        user: { id: "user-1", email: "alice@sso-corp.com" },
        account: ssoAccount,
      });
      const result2 = await signInCallback({
        user: { id: "user-1", email: "alice@sso-corp.com" },
        account: ssoAccount,
      });

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});
