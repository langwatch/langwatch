/**
 * See specs/licensing/sso-license-gating.feature — a user who recovered on a
 * denied SSO deployment via the v6 password-reset path owns a `credential`
 * account and must be able to change it. `changePassword`'s provider guard is
 * therefore keyed off the RESOLVED provider (coerced to "email" when the gate
 * denies), not raw env — otherwise the coerced UI offers a button the backend
 * always rejects.
 *
 * What the ROUTER decides is asserted here: which of the two credential stores
 * the deployment's provider sends the change to, and which transport code each
 * refusal becomes. Proving the current password, writing the new one and
 * ending the other sessions are `CredentialAccountService`'s, and its own test
 * drives them over fakes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

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
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const {
  resolveAuthProviderMock,
  changePasswordMock,
  changeFederatedPasswordMock,
  hasPasswordMock,
} = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
  changePasswordMock: vi.fn(),
  changeFederatedPasswordMock: vi.fn(),
  hasPasswordMock: vi.fn(),
}));
vi.mock("@ee/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  credentialAccounts: () => ({
    changePassword: changePasswordMock,
    changeFederatedPassword: changeFederatedPasswordMock,
    hasPassword: hasPasswordMock,
  }),
}));

describe("userRouter.changePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changePasswordMock.mockResolvedValue("changed");
    changeFederatedPasswordMock.mockResolvedValue("changed");
    // Nobody holds a password of this deployment's own unless a scenario says
    // so. That is the state every deployment shipping today is in, and it is
    // what keeps the broker branch answering exactly as it did before.
    hasPasswordMock.mockResolvedValue(false);
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
          email: "sso-born@acme.com",
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

  const call = () =>
    createCaller().changePassword({
      currentPassword: "current-password",
      newPassword: "brand-new-password-1",
    });

  describe("given an operator is impersonating the account", () => {
    /** @scenario "An impersonating operator cannot set or change a password" */
    it("refuses before the credential path is reached", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");

      await expect(
        createCaller({ impersonating: true }).changePassword({
          currentPassword: "current-password",
          newPassword: "brand-new-password-1",
        }),
      ).rejects.toMatchObject({
        cause: { code: "impersonation_cannot_change_credentials" },
      });

      expect(changePasswordMock).not.toHaveBeenCalled();
    });
  });

  describe("given a denied SSO deployment coerced to email mode", () => {
    /** @scenario Existing users on an unlicensed deployment self-recover via password reset */
    it("passes the provider guard and reaches the credential path", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");

      await expect(call()).resolves.toMatchObject({ success: true });

      expect(changePasswordMock).toHaveBeenCalledWith({
        userId: "user-1",
        currentPassword: "current-password",
        newPassword: "brand-new-password-1",
        keepSessionId: "sess-1",
      });
      expect(changeFederatedPasswordMock).not.toHaveBeenCalled();
    });

    it("reports an account with no password set as not found", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");
      changePasswordMock.mockResolvedValue("no_password_set");

      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("reports a current password that did not match as unauthorized", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");
      changePasswordMock.mockResolvedValue("wrong_password");

      await expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("given a licensed social-SSO deployment", () => {
    it("refuses password changes for the configured provider", async () => {
      resolveAuthProviderMock.mockResolvedValue("google");

      await expect(call()).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(changePasswordMock).not.toHaveBeenCalled();
      expect(changeFederatedPasswordMock).not.toHaveBeenCalled();
    });
  });

  describe("given a licensed Auth0 deployment", () => {
    it("sends the change to the identity provider rather than to our own rows", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(call()).resolves.toMatchObject({ success: true });

      expect(changeFederatedPasswordMock).toHaveBeenCalledWith({
        userId: "user-1",
        email: "sso-born@acme.com",
        currentPassword: "current-password",
        newPassword: "brand-new-password-1",
        keepSessionId: "sess-1",
      });
      expect(changePasswordMock).not.toHaveBeenCalled();
    });

    it("reports an account with no Auth0 database connection as not found", async () => {
      // Only that connection has a password the Management API can update;
      // social identities linked through Auth0 are their providers' to change.
      resolveAuthProviderMock.mockResolvedValue("auth0");
      changeFederatedPasswordMock.mockResolvedValue("no_federated_account");

      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("given a broker deployment where the person holds a password of ours", () => {
    /** @scenario "A change targets the password the person actually signs in with" */
    it("changes our own password rather than the broker's copy", async () => {
      // The failure this is here for: reading the provider alone sent
      // somebody holding one of OUR passwords to the broker, which looks for
      // an `auth0|` row, finds none, and refuses — set a password, then be
      // told no Auth0 account is linked. For somebody holding both it was
      // worse, rewriting the broker's copy and reporting success for a change
      // their next sign-in would not see.
      resolveAuthProviderMock.mockResolvedValue("auth0");
      hasPasswordMock.mockResolvedValue(true);

      await expect(call()).resolves.toMatchObject({ success: true });

      expect(changePasswordMock).toHaveBeenCalledWith({
        userId: "user-1",
        currentPassword: "current-password",
        newPassword: "brand-new-password-1",
        keepSessionId: "sess-1",
      });
      expect(changeFederatedPasswordMock).not.toHaveBeenCalled();
    });
  });
});
