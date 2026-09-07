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
 *
 * What the ROUTER decides is asserted here: the policy, the provider gate, the
 * session it is willing to spare, and the refusal it turns into a transport
 * code. Writing the hash, creating the row and ending the other sessions are
 * `CredentialAccountService`'s, and its own test drives them over fakes.
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

const { resolveAuthProviderMock, setFirstPasswordMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
  setFirstPasswordMock: vi.fn(),
}));
vi.mock("@ee/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));
// Only the credential-account factory is replaced: the router reads the rest
// of the identity runtime for sign-up verification.
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  credentialAccounts: () => ({ setFirstPassword: setFirstPasswordMock }),
}));

describe("userRouter.setPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthProviderMock.mockResolvedValue("email");
    setFirstPasswordMock.mockResolvedValue("set");
  });

  const createCaller = ({
    impersonating = false,
  }: {
    impersonating?: boolean;
  } = {}) => {
    const ctx = createInnerTRPCContext({
      session: {
        user: {
          id: "user-1",
          email: "sam@acme.com",
          ...(impersonating
            ? { impersonator: { id: "operator-1", email: "ops@acme.com" } }
            : {}),
        },
        sessionId: "sess-1",
        expires: "2099-01-01",
      },
    });
    return userRouter.createCaller(ctx);
  };

  const call = (password = "a-good-password") =>
    createCaller().setPassword({ password });

  describe("given an account created by a passkey, holding no password", () => {
    /** @scenario An account with no password can set a first one */
    it("hands the typed password to the credential service and reports success", async () => {
      await expect(call()).resolves.toMatchObject({ success: true });

      expect(setFirstPasswordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          password: "a-good-password",
        }),
      );
    });

    /** @scenario A new password ends every other session */
    it("names the tab that is asking as the one session to spare", async () => {
      await call();

      expect(setFirstPasswordMock).toHaveBeenCalledWith(
        expect.objectContaining({ keepSessionId: "sess-1" }),
      );
    });

    it("spares nothing while an operator is impersonating", async () => {
      // The session id in hand is the operator's, so sparing it would sign the
      // subject out of every device and leave the operator's tab open.
      await createCaller({ impersonating: true }).setPassword({
        password: "a-good-password",
      });

      expect(setFirstPasswordMock).toHaveBeenCalledWith(
        expect.objectContaining({ keepSessionId: null }),
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
    it("refuses, in the words the screen shows", async () => {
      setFirstPasswordMock.mockResolvedValue("already_has_password");

      await expect(call()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("already has a password"),
      });
    });
  });

  describe("given a password the shared policy refuses", () => {
    it("names the field, so the refusal lands where the person is looking", async () => {
      await expect(call("short")).rejects.toMatchObject({
        // The policy check runs before anything is read or written.
        message: expect.stringContaining("8"),
      });
      expect(setFirstPasswordMock).not.toHaveBeenCalled();
    });
  });

  describe("given a deployment that federates", () => {
    it("refuses, because the password does not live here", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(setFirstPasswordMock).not.toHaveBeenCalled();
    });
  });
});
