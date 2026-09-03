/**
 * Setting a FIRST password, for an account that has none.
 *
 * Spec: specs/identity/passkeys.feature
 *
 * Passkey sign-up made passwordless accounts real, and "forgot password" does
 * not rescue one on its own: it updates credential rows in place, so an
 * account that never had a password matched nothing and was told the reset had
 * worked. This is the way out of that, and the reason it is safe to expose
 * with no proof beyond the session is the one refusal asserted below — it can
 * fill an empty slot and never replace a full one.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email", BASE_HOST: "http://localhost:5560" },
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// The tRPC error-audit middleware writes through the real prisma singleton, so
// a mutation that throws here reaches a live client unless it is stubbed.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const { resolveAuthProviderMock, revokeOtherSessionsMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
  revokeOtherSessionsMock: vi.fn(),
}));
vi.mock("@ee/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));
// Only the revocation factory is replaced: the router reads the rest of the
// identity runtime for sign-up identifiers and verification.
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  sessionRevocation: () => ({ revokeOthers: revokeOtherSessionsMock }),
}));

describe("userRouter.setPassword", () => {
  let accountFindFirst: ReturnType<typeof vi.fn>;
  let accountUpdate: ReturnType<typeof vi.fn>;
  let accountCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthProviderMock.mockResolvedValue("email");
    revokeOtherSessionsMock.mockResolvedValue(void 0);
    accountFindFirst = vi.fn().mockResolvedValue(null);
    accountUpdate = vi.fn().mockResolvedValue({});
    accountCreate = vi.fn().mockResolvedValue({});
  });

  const createCaller = () => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sam@acme.com" },
        sessionId: "sess-1",
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = {
      account: {
        findFirst: accountFindFirst,
        update: accountUpdate,
        create: accountCreate,
      },
    };
    return userRouter.createCaller(ctx);
  };

  const call = (password = "a-good-password") =>
    createCaller().setPassword({ password });

  describe("given an account created by a passkey, holding no password", () => {
    /** @scenario An account with no password can set a first one */
    it("fills the empty credential row rather than asking for a current password", async () => {
      accountFindFirst.mockResolvedValue({ id: "acc-1", password: null });

      await expect(call()).resolves.toMatchObject({ success: true });

      expect(accountUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "acc-1" } }),
      );
      // Hashed, never the plaintext that was typed.
      const written = accountUpdate.mock.calls[0]?.[0].data.password as string;
      expect(written).not.toBe("a-good-password");
      expect(written.startsWith("$2")).toBe(true);
    });

    it("creates the credential row where an older account has none", async () => {
      accountFindFirst.mockResolvedValue(null);

      await expect(call()).resolves.toMatchObject({ success: true });

      // The row is what password reset updates in place, so recovery cannot
      // work until it exists.
      expect(accountCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            provider: "credential",
          }),
        }),
      );
    });

    /** @scenario A new password ends every other session */
    it("ends every other session, because a password outlives revoking one", async () => {
      accountFindFirst.mockResolvedValue({ id: "acc-1", password: null });

      await call();

      expect(revokeOtherSessionsMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", keepSessionId: "sess-1" }),
      );
    });
  });

  describe("given an account that already has a password", () => {
    /**
     * The refusal the whole endpoint rests on. Setting a password takes no
     * proof beyond the session; letting it REPLACE one would turn a stolen
     * session into a credential that survives the session being revoked.
     */
    /** @scenario Setting a password can never overwrite one */
    it("refuses, and writes nothing", async () => {
      accountFindFirst.mockResolvedValue({ id: "acc-1", password: "$2b$10$x" });

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(accountUpdate).not.toHaveBeenCalled();
      expect(accountCreate).not.toHaveBeenCalled();
      expect(revokeOtherSessionsMock).not.toHaveBeenCalled();
    });
  });

  describe("given a password the shared policy refuses", () => {
    it("names the field, so the refusal lands where the person is looking", async () => {
      await expect(call("short")).rejects.toMatchObject({
        // The policy check runs before anything is read or written.
        message: expect.stringContaining("8"),
      });
      expect(accountFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("given a deployment that federates", () => {
    it("refuses, because the password does not live here", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(accountFindFirst).not.toHaveBeenCalled();
    });
  });
});
