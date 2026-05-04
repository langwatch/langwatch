import { describe, expect, it } from "vitest";

describe("better-auth config", () => {
  describe("when imported", () => {
    /** @scenario BetterAuth is the live handler */
    it("exports an auth instance without throwing", async () => {
      const module = await import("../index");
      expect(module.auth).toBeDefined();
      expect(typeof module.auth.handler).toBe("function");
    });
  });

  describe("when inspected", () => {
    it("has the email-and-password API enabled", async () => {
      const { auth } = await import("../index");
      // Sanity check: the api object has the signIn endpoint group
      expect(auth.api).toBeDefined();
      expect(typeof (auth.api as any).signInEmail).toBe("function");
    });

    it("enables account linking so orphan email-verified Users can sign in via OAuth", async () => {
      // Regression: a User row with emailVerified=true but zero Account rows
      // (pre-seeded invite, half-finished signup, or migration leftover)
      // permanently blocks subsequent OAuth sign-ins for that email — error
      // surfaces as "registered with another authentication method". On
      // SSO-enforced orgs this locked users out even after successful IdP
      // auth. Enabling accountLinking lets BetterAuth attach the new Account
      // to the existing email-verified User. SSO-domain enforcement still
      // runs in beforeAccountCreate, so wrong providers are rejected.
      const { auth } = await import("../index");
      const options = (auth as any).options;
      expect(options?.account?.accountLinking?.enabled).toBe(true);
    });

    it("forces sessions to be stored in the database (not Redis-only)", async () => {
      // Regression for iter-19 bug 15: with `secondaryStorage` set,
      // BetterAuth's `createSession` skips the main Prisma adapter unless
      // `session.storeSessionInDatabase: true` is explicitly set. That
      // breaks `Session.impersonating` reads/writes (impersonation flow)
      // because the row only exists in Redis. This assertion locks the
      // option in so it can't be silently removed.
      const { auth } = await import("../index");
      const options = (auth as any).options;
      expect(options?.session?.storeSessionInDatabase).toBe(true);
    });

    /** @scenario Credentials-only on-prem mode */
    /** @scenario The BetterAuth admin plugin is intentionally omitted */
    it("does not register the BetterAuth admin plugin", async () => {
      const { auth } = await import("../index");
      const options = (auth as any).options;
      const pluginIds = (options?.plugins ?? []).map(
        (p: { id?: string }) => p?.id,
      );
      expect(pluginIds).not.toContain("admin");
      // Only genericOAuth (or empty) is acceptable — impersonation is handled
      // via the legacy Session.impersonating JSON column, not via the
      // admin() plugin.
      for (const id of pluginIds) {
        expect(id).toBe("generic-oauth");
      }
    });

    it("gates emailAndPassword.enabled on NEXTAUTH_PROVIDER=email", async () => {
      // Regression for iter-20 bug 16: BetterAuth's email/password routes
      // (`/sign-up/email`, `/sign-in/email`) were unconditionally enabled,
      // letting attackers bypass Auth0/SSO in cloud mode. The original
      // NextAuth code added EITHER a social provider OR CredentialsProvider,
      // never both. The BetterAuth equivalent must mirror that gate.
      const { auth } = await import("../index");
      const options = (auth as any).options;
      const { env } = await import("~/env.mjs");
      const expected = env.NEXTAUTH_PROVIDER === "email";
      expect(options?.emailAndPassword?.enabled).toBe(expected);
    });
  });
});
