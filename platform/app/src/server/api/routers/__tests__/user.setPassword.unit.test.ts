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
vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
vi.mock("~/runtime/app/features/sso", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));
describe("userRouter.setPassword", () => {
  let setFirstPassword: ReturnType<typeof vi.fn>;
  let revokeOtherBrowserSessions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthProviderMock.mockResolvedValue("email");
    setFirstPassword = vi.fn().mockResolvedValue("set");
    revokeOtherBrowserSessions = vi.fn().mockResolvedValue(undefined);
  });

  const createCaller = () => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sam@acme.com" },
        sessionId: "sess-1",
        expires: "2099-01-01",
      },
      app: {
        users: { setFirstPassword },
        auth: { revokeOtherBrowserSessions },
        permissions: {
          checkScopeLineage: vi.fn().mockResolvedValue({ kind: "consistent" }),
        },
      } as never,
    });
    return userRouter.createCaller(ctx);
  };

  const call = (password = "a-good-password") => createCaller().setPassword({ password });

  describe("given an account created by a passkey, holding no password", () => {
    /** @scenario An account with no password can set a first one */
    it("fills the empty credential row rather than asking for a current password", async () => {
      await expect(call()).resolves.toMatchObject({ success: true });
      expect(setFirstPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "user-1",
          passwordHash: expect.stringMatching(/^\$2/),
        }),
      );
    });

    it("creates the credential row where an older account has none", async () => {
      await expect(call()).resolves.toMatchObject({ success: true });
      expect(setFirstPassword).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }));
    });

    /** @scenario A new password ends every other session */
    it("ends every other session, because a password outlives revoking one", async () => {
      await call();

      expect(revokeOtherBrowserSessions).toHaveBeenCalledWith(
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
      setFirstPassword.mockResolvedValue("already_set");

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });
  });

  describe("given a password the shared policy refuses", () => {
    it("names the field, so the refusal lands where the person is looking", async () => {
      await expect(call("short")).rejects.toMatchObject({
        // The policy check runs before anything is read or written.
        message: expect.stringContaining("8"),
      });
      expect(setFirstPassword).not.toHaveBeenCalled();
    });
  });

  describe("given a deployment that federates", () => {
    it("refuses, because the password does not live here", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(setFirstPassword).not.toHaveBeenCalled();
    });
  });
});
