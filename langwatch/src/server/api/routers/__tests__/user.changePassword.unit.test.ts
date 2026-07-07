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
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "google", BASE_HOST: "http://localhost:5560" },
}));

vi.mock("~/server/redis", () => ({ connection: undefined }));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
vi.mock("~/server/sso/sso-gate", () => ({
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
    });
    (ctx as any).prisma = { account: { findFirst: accountFindFirst } };
    return userRouter.createCaller(ctx);
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
});
