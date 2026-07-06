/**
 * See specs/licensing/sso-license-gating.feature — "Existing users on an
 * unlicensed deployment self-recover via password reset".
 *
 * The whole ADR-027 v6 denied-mode reset exception rests on an upstream
 * better-auth behavior: `resetPassword` CREATES a credential account when
 * the user only has an OAuth account (routes/password.mjs). This test pins
 * that premise against the real library (memory adapter, real handlers) so
 * a better-auth upgrade that changes it goes red here instead of silently
 * hard-stranding every existing user on denied installs.
 */

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";

type MemoryDB = Record<string, Record<string, unknown>[]>;

function buildAuth(db: MemoryDB, onResetUrl: (url: string) => void) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ url }) => {
        onResetUrl(url);
      },
    },
  });
}

describe("password reset for an OAuth-born user (upstream premise pin)", () => {
  let db: MemoryDB;
  let resetUrl: string | undefined;
  let auth: ReturnType<typeof buildAuth>;

  beforeEach(async () => {
    db = { user: [], session: [], account: [], verification: [] };
    resetUrl = undefined;
    auth = buildAuth(db, (url) => {
      resetUrl = url;
    });

    // An SSO-born user: user row + OAuth account row, NO credential account.
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      email: "sso-born@example.com",
      name: "SSO Born",
      emailVerified: true,
    });
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "auth0",
      accountId: "auth0|123",
    });
  });

  describe("when the user completes a password reset from their inbox", () => {
    /** @scenario Existing users on an unlicensed deployment self-recover via password reset */
    it("creates a credential account and email sign-in succeeds", async () => {
      await auth.api.requestPasswordReset({
        body: {
          email: "sso-born@example.com",
          redirectTo: "/auth/reset-password",
        },
      });
      expect(resetUrl).toBeDefined();
      const token = new URL(resetUrl!).pathname.split("/").pop();
      expect(token).toBeTruthy();

      await auth.api.resetPassword({
        body: { token: token!, newPassword: "brand-new-password-1" },
      });

      const credentialAccounts = db.account!.filter(
        (a) => a.providerId === "credential",
      );
      expect(credentialAccounts).toHaveLength(1);

      const session = await auth.api.signInEmail({
        body: {
          email: "sso-born@example.com",
          password: "brand-new-password-1",
        },
      });
      expect(session.user.email).toBe("sso-born@example.com");
    });
  });
});
