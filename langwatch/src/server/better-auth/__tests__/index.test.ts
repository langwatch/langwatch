import { hash } from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
    // Verifies that impersonation stays in Session.impersonating, not the admin() plugin.
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

    /** @scenario DIFFERENT_EMAIL_NOT_ALLOWED guard */
    it("does not allow account linking with a different email (DIFFERENT_EMAIL_NOT_ALLOWED guard)", async () => {
      // BetterAuth's `allowDifferentEmails` defaults to false. Not setting it
      // means: if an OAuth callback returns a profile whose email differs from
      // the currently-signed-in user's email, BetterAuth fires
      // LINKING_DIFFERENT_EMAILS_NOT_ALLOWED (surfaced in /auth/error as
      // DIFFERENT_EMAIL_NOT_ALLOWED). The config guard is the single line
      // that enforces this — it must not be changed to `true`.
      const { auth } = await import("../index");
      const options = (auth as any).options;
      expect(options?.account?.accountLinking?.allowDifferentEmails).toBeFalsy();
    });

    /** @scenario Legacy bcrypt hashes still verify */
    it("verifies a bcrypt hash from the legacy NextAuth system via the credentials verify function", async () => {
      // `emailAndPassword.password.verify` is wired to `compare(password, storedHash)`
      // from the bcrypt package. This locks the wiring in: a maintainer removing
      // or replacing the verify function would need to update this test.
      const { auth } = await import("../index");
      const options = (auth as any).options;
      const verifyFn = options?.emailAndPassword?.password?.verify as
        | ((args: { password: string; hash: string }) => Promise<boolean>)
        | undefined;
      expect(verifyFn).toBeDefined();
      const legacyHash = await hash("hunter2", 10);
      expect(await verifyFn!({ password: "hunter2", hash: legacyHash })).toBe(
        true,
      );
    });

    /** @scenario Wrong password is rejected */
    it("rejects a wrong password via the credentials verify function", async () => {
      const { auth } = await import("../index");
      const options = (auth as any).options;
      const verifyFn = options?.emailAndPassword?.password?.verify as
        | ((args: { password: string; hash: string }) => Promise<boolean>)
        | undefined;
      const legacyHash = await hash("hunter2", 10);
      expect(
        await verifyFn!({ password: "wrong-password", hash: legacyHash }),
      ).toBe(false);
    });
  });
});

// Provider-mode tests require resetting the module cache so `index.ts` top-level
// code re-runs with the stubbed env vars. These run AFTER the main describe
// to avoid interfering with its cached module instance.
// Note: vi.unstubAllEnvs() in afterAll restores process.env; vi.resetModules()
// ensures the fresh import picks up the stubbed values rather than the cache.
describe("better-auth config — env-mocked provider modes", () => {
  describe("when NEXTAUTH_PROVIDER is auth0", () => {
    let authModule: Awaited<typeof import("../index")>;

    beforeAll(async () => {
      vi.resetModules();
      vi.stubEnv("NEXTAUTH_PROVIDER", "auth0");
      vi.stubEnv("AUTH0_CLIENT_ID", "test-client-id");
      vi.stubEnv("AUTH0_CLIENT_SECRET", "test-client-secret");
      vi.stubEnv("AUTH0_ISSUER", "https://dev.us.auth0.com");
      vi.stubEnv("NEXTAUTH_URL", "https://langwatch.ai");
      authModule = await import("../index");
    });

    afterAll(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    /** @scenario Auth0 enterprise mode */
    it("registers the generic-oauth plugin for auth0 and disables email-and-password", () => {
      const options = (authModule.auth as any).options;
      const pluginIds = (options?.plugins ?? []).map(
        (p: { id?: string }) => p?.id,
      );
      // The auth0 helper registers under the "generic-oauth" plugin id
      expect(pluginIds).toContain("generic-oauth");
      // In SSO mode email-and-password is disabled (gate: NEXTAUTH_PROVIDER === "email")
      expect(options?.emailAndPassword?.enabled).toBe(false);
    });
  });

  describe("when NEXTAUTH_PROVIDER is google", () => {
    let authModule: Awaited<typeof import("../index")>;

    beforeAll(async () => {
      vi.resetModules();
      vi.stubEnv("NEXTAUTH_PROVIDER", "google");
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
      vi.stubEnv("NEXTAUTH_URL", "https://langwatch.ai");
      authModule = await import("../index");
    });

    afterAll(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    /** @scenario Google mode */
    it("includes google in the socialProviders", () => {
      const options = (authModule.auth as any).options;
      expect(options?.socialProviders?.google).toBeDefined();
      expect(options?.socialProviders?.google?.clientId).toBe("google-client-id");
    });
  });
});
