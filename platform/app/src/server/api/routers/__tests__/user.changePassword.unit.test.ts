/**
 * See specs/licensing/sso-license-gating.feature — a user who recovered on a
 * denied SSO deployment via the v6 password-reset path owns a `credential`
 * account and must be able to change it. `changePassword`'s provider guard is
 * therefore keyed off the RESOLVED provider (coerced to "email" when the gate
 * denies), not raw env — otherwise the coerced UI offers a button the backend
 * always rejects.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { appRouter } from "../../root";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "google", BASE_HOST: "http://localhost:5560" },
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// The tRPC error-audit middleware writes through the real prisma singleton, so
// a mutation that throws here reaches a live client and fails with a Prisma
// validation error that masks the assertion. Shard-order dependent: on its own
// this file passes, batched with a test that initializes the app singleton it
// does not.
vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
vi.mock("~/runtime/app/features/sso", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAuthProvider: resolveAuthProviderMock,
}));

describe("userRouter.changePassword", () => {
  let accountFindFirst: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    accountFindFirst = vi.fn().mockResolvedValue(null);
  });

  const createCaller = () => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sso-born@acme.com" },
        sessionId: "sess-1",
        expires: "2099-01-01",
      },
      // The base policy chain runs the scope-lineage guard on every
      // procedure, so even a mutation that names no scope needs the
      // authorization service the process composes.
      app: {
        permissions: {
          checkScopeLineage: vi.fn().mockResolvedValue({ kind: "consistent" }),
        },
      } as never,
    });
    (ctx as any).prisma = { account: { findFirst: accountFindFirst } };
    return appRouter.createCaller(ctx).user;
  };

  const call = () =>
    createCaller().changePassword({
      currentPassword: "current-password",
      newPassword: "brand-new-password-1",
    });

  describe("given a denied SSO deployment coerced to email mode", () => {
    /** @scenario Existing users on an unlicensed deployment self-recover via password reset */
    it("passes the provider guard and reaches the credential path", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");

      // No credential account seeded → the credential path throws NOT_FOUND.
      // Reaching that error proves the provider guard did NOT reject the call.
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(accountFindFirst).toHaveBeenCalled();
    });
  });

  describe("given a licensed social-SSO deployment", () => {
    it("refuses password changes for the configured provider", async () => {
      resolveAuthProviderMock.mockResolvedValue("google");

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(accountFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("given a licensed Auth0 deployment", () => {
    it("passes the provider guard and looks up the Auth0 database account", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      // Only the `auth0|` database connection has a password the Management
      // API can update, so the lookup must be narrowed to it rather than
      // matching any Auth0-linked social identity.
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(accountFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: "auth0",
            providerAccountId: { startsWith: "auth0|" },
          }),
        }),
      );
    });
  });
});
