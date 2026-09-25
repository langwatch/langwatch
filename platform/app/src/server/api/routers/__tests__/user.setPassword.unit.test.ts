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

// Mutable, because whether the deployment issues its OWN passwords beside a
// provider is read off the environment (D09) and one scenario below turns it
// on. `beforeEach` puts it back.
const { envMock } = vi.hoisted(() => ({
  envMock: {
    NEXTAUTH_PROVIDER: "email",
    BASE_HOST: "http://localhost:5560",
    LOCAL_PASSWORDS_ENABLED: "off",
  } as {
    NEXTAUTH_PROVIDER: string;
    BASE_HOST: string;
    LOCAL_PASSWORDS_ENABLED: string;
  },
}));
vi.mock("../../../../env.mjs", () => ({ env: envMock }));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// The tRPC error-audit middleware writes through the real prisma singleton, so
// a mutation that throws here reaches a live client unless it is stubbed.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const {
  resolveAuthProviderMock,
  setFirstPasswordMock,
  addressRoutesToConnectionMock,
} = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
  setFirstPasswordMock: vi.fn(),
  addressRoutesToConnectionMock: vi.fn(),
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
  // No organization routes this suite's address. The real one asks the
  // router, which reaches Prisma — and the question it answers has its own
  // scenario; here it must simply not be the thing under test.
  addressRoutesToConnection: addressRoutesToConnectionMock,
}));

describe("userRouter.setPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthProviderMock.mockResolvedValue("email");
    setFirstPasswordMock.mockResolvedValue("set");
    addressRoutesToConnectionMock.mockResolvedValue(false);
    envMock.LOCAL_PASSWORDS_ENABLED = "off";
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
  });

  describe("given an operator is impersonating the account", () => {
    /** @scenario "An impersonating operator cannot set or change a password" */
    it("refuses before the credential writer is reached", async () => {
      await expect(
        createCaller({ impersonating: true }).setPassword({
          password: "a-good-password",
        }),
      ).rejects.toMatchObject({
        cause: { code: "impersonation_cannot_change_credentials" },
      });

      // The whole point: no credential is minted on the subject.
      expect(setFirstPasswordMock).not.toHaveBeenCalled();
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

  describe("given an address an organization routes through its own provider", () => {
    /** @scenario "An organization's own connection still refuses a local password" */
    it("refuses even where the deployment issues its own passwords", async () => {
      // The mode this has to be asserted in, and the only one where the
      // refusal is load-bearing: a broker deployment that ALSO issues its own
      // passwords. The provider gate above lets that through by design, so
      // without this the address would reach a password.
      //
      // Which is the bypass: a company mandating SSO gets session lifetime,
      // conditional access and revocation from its own connection, and a
      // local password beside it answers none of them. Widening WHO may hold
      // a password never overrules whose company has already said otherwise.
      resolveAuthProviderMock.mockResolvedValue("auth0");
      envMock.LOCAL_PASSWORDS_ENABLED = "on";
      addressRoutesToConnectionMock.mockResolvedValue(true);

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(setFirstPasswordMock).not.toHaveBeenCalled();
    });

    /** @scenario "An organization's own connection still refuses a local password" */
    it("lets an ordinary address through on that same deployment", async () => {
      // The control. Without it the test above passes on a deployment that
      // refuses everybody, which is exactly what the provider gate did before
      // the switch existed and would prove nothing about the connection.
      resolveAuthProviderMock.mockResolvedValue("auth0");
      envMock.LOCAL_PASSWORDS_ENABLED = "on";

      await expect(call()).resolves.toMatchObject({ success: true });
      expect(setFirstPasswordMock).toHaveBeenCalled();
    });
  });
});
