/**
 * See specs/licensing/sso-license-gating.feature — the signup page registers
 * through this tRPC mutation (not better-auth's /sign-up/email), so the
 * ADR-027 email-mode coercion must apply here too: on a denied SSO-capable
 * deployment the resolved provider is "email" and registration must work,
 * while a licensed SSO deployment keeps refusing direct registration.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "auth0", BASE_HOST: "http://localhost:5560" },
}));

vi.mock("~/server/redis", () => ({ connection: undefined }));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("~/utils/getClientIp", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
vi.mock("~/server/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));

describe("userRouter.register", () => {
  let userCreateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    userCreateMock = vi.fn().mockResolvedValue({ id: "user-1" });
  });

  const createCaller = () => {
    const ctx = createInnerTRPCContext({ session: null });
    (ctx as any).prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { create: userCreateMock },
          account: { create: vi.fn().mockResolvedValue({ id: "acc-1" }) },
        }),
    };
    return userRouter.createCaller(ctx);
  };

  describe("given an SSO-capable deployment where the gate DENIES (coerced email mode)", () => {
    /** @scenario A fresh unlicensed deployment bootstraps via email signup */
    it("registers the user through the signup form's tRPC path", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");

      await expect(
        createCaller().register({
          name: "Operator",
          email: "operator@example.com",
          password: "password-123",
        }),
      ).resolves.toMatchObject({ id: "user-1" });
      expect(userCreateMock).toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate ALLOWS", () => {
    /** @scenario A licensed deployment cannot mint password accounts */
    it("refuses direct registration", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(
        createCaller().register({
          name: "Attacker",
          email: "attacker@example.com",
          password: "password-123",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(userCreateMock).not.toHaveBeenCalled();
    });
  });
});
