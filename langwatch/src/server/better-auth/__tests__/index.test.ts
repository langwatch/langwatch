import { describe, expect, it } from "vitest";

describe("better-auth config", () => {
  describe("when imported", () => {
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
