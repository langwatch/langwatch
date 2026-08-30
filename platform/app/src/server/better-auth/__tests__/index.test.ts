import { hash } from "bcrypt";
import { describe, expect, it, vi } from "vitest";

// Must be mocked before importing ../index — both create persistent handles
// (Redis socket, Prisma connection pool) that prevent Vite from closing after
// tests pass, causing shard 2 to hang until GitHub Actions cancels it.
// Established pattern: see fallbackName.test.ts line 17-18.
vi.mock("~/server/db", () => ({ prisma: {} }));

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
      // The allow-list is the point: a plugin appearing here that nobody
      // deliberately registered is the failure this catches, and `admin` in
      // particular would take impersonation over from the legacy
      // Session.impersonating JSON column.
      //
      // `two-factor` (D06) and `passkey` (D07) are registered only when
      // their env flag is on, which is why they are permitted rather than
      // required — with both flags off the array is genericOAuth or empty,
      // exactly as before.
      const deliberate = ["generic-oauth", "two-factor", "passkey"];
      for (const id of pluginIds) {
        expect(deliberate).toContain(id);
      }
    });

    /** @scenario "With the flag off nothing about two-step verification exists" */
    /** @scenario "With the flag off, passkeys do not exist" */
    it("registers a factor plugin only when its flag is on", async () => {
      // Both flags default off, so re-importing the module under each
      // setting is what makes this a real check rather than one that
      // happens to pass because nothing was ever turned on.
      const pluginIdsUnder = async (flags: {
        MFA_ENROLLMENT_OPEN: string;
        PASSKEYS_ENABLED: string;
      }): Promise<string[]> => {
        vi.resetModules();
        const { env } = await import("~/env.mjs");
        vi.spyOn(env, "MFA_ENROLLMENT_OPEN", "get").mockReturnValue(
          flags.MFA_ENROLLMENT_OPEN as never,
        );
        vi.spyOn(env, "PASSKEYS_ENABLED", "get").mockReturnValue(
          flags.PASSKEYS_ENABLED as never,
        );
        const { auth } = await import("../index");
        return ((auth as any).options?.plugins ?? []).map(
          (p: { id?: string }) => p?.id,
        );
      };

      // Not registered means the routes are not mounted, so nothing about
      // the feature is reachable — the flag governs the surface, not just
      // whether a screen renders.
      const off = await pluginIdsUnder({
        MFA_ENROLLMENT_OPEN: "off",
        PASSKEYS_ENABLED: "off",
      });
      expect(off).not.toContain("two-factor");
      expect(off).not.toContain("passkey");

      const on = await pluginIdsUnder({
        MFA_ENROLLMENT_OPEN: "on",
        PASSKEYS_ENABLED: "on",
      });
      expect(on).toContain("two-factor");
      expect(on).toContain("passkey");

      vi.restoreAllMocks();
      vi.resetModules();
    });

    it("gates emailAndPassword.enabled on NEXTAUTH_PROVIDER=email or self-hosted (ADR-027)", async () => {
      // Regression for iter-20 bug 16: BetterAuth's email/password routes
      // (`/sign-up/email`, `/sign-in/email`) were unconditionally enabled,
      // letting attackers bypass Auth0/SSO in cloud mode. The original
      // NextAuth code added EITHER a social provider OR CredentialsProvider,
      // never both. The BetterAuth equivalent must mirror that gate.
      //
      // ADR-027 widens this: on self-hosted (`!IS_SAAS`) the routes are
      // always mounted (even with an enterprise IdP configured) so a
      // denied/coerced deployment has a working email door and licensed
      // installs keep password-reset self-recovery reachable. Mounting
      // alone is not the gate — the ALLOW-path `before`-hook block (gate
      // site #3, tested in `ssoGate.hook.test.ts`) is the load-bearing
      // guard that stops a licensed install from minting password
      // accounts through these routes. SaaS is unchanged.
      const { auth } = await import("../index");
      const options = (auth as any).options;
      const { env } = await import("~/env.mjs");
      const expected = env.NEXTAUTH_PROVIDER === "email" || !env.IS_SAAS;
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
      expect(
        options?.account?.accountLinking?.allowDifferentEmails,
      ).toBeFalsy();
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

  describe("when NEXTAUTH_PROVIDER selects auth0", () => {
    /** @scenario Auth0 enterprise mode */
    it("lists an auth0 provider and disables email/password (SSO-only)", async () => {
      // The env-driven provider selection lives in pure builders so we can
      // exercise auth0 mode without re-initializing the module under a
      // different NEXTAUTH_PROVIDER (which would need vi.resetModules()).
      const { isEmailPasswordEnabled } = await import("../index");
      const { buildGenericOAuthConfigs } = await import("@ee/sso/providers");
      const e = {
        NEXTAUTH_PROVIDER: "auth0",
        IS_SAAS: true,
        AUTH0_CLIENT_ID: "auth0-client-id",
        AUTH0_CLIENT_SECRET: "auth0-client-secret",
        AUTH0_ISSUER: "tenant.us.auth0.com",
        OKTA_CLIENT_ID: undefined,
        OKTA_CLIENT_SECRET: undefined,
        OKTA_ISSUER: undefined,
        NEXTAUTH_URL: "http://localhost:3000",
      };
      const configs = buildGenericOAuthConfigs(e);
      const providerIds = configs.map(
        (c) => (c as { providerId?: string }).providerId,
      );
      expect(providerIds).toContain("auth0");
      // Lock the OAuth `redirect_uri` to the legacy NextAuth callback path.
      // Auth0 only has this path registered as an allowed callback; sending a
      // different `redirect_uri` (e.g. BetterAuth's default
      // `/api/auth/oauth2/callback/auth0`) makes Auth0 reject the
      // authorization request — a customer-breaking regression.
      const auth0Config = configs.find(
        (c) => (c as { providerId?: string }).providerId === "auth0",
      ) as { redirectURI?: string } | undefined;
      expect(auth0Config?.redirectURI).toBe(
        "http://localhost:3000/api/auth/callback/auth0",
      );
      // SSO-only enforcement on SaaS: no email/password bypass of the IdP.
      expect(isEmailPasswordEnabled(e)).toBe(false);
    });

    /** @scenario Self-hosted that never had a license hides SSO and offers email sign-in */
    it("mounts email/password on self-hosted so a denied deployment keeps a door", async () => {
      const { isEmailPasswordEnabled } = await import("../index");

      // ADR-027: mounting is not the gate. Self-hosted always mounts so an
      // unlicensed deployment can sign in, and a licensed one keeps password
      // reset reachable; the `before` hook is what refuses the email routes
      // when the gate allows.
      expect(
        isEmailPasswordEnabled({ NEXTAUTH_PROVIDER: "auth0", IS_SAAS: false }),
      ).toBe(true);
    });
  });

  describe("when NEXTAUTH_PROVIDER selects google", () => {
    /** @scenario Google mode */
    it("includes google in the socialProviders map", async () => {
      const { buildSocialProviders } = await import("@ee/sso/providers");
      const socialProviders = buildSocialProviders({
        NEXTAUTH_PROVIDER: "google",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: undefined,
        GITLAB_CLIENT_ID: undefined,
        GITLAB_CLIENT_SECRET: undefined,
        AZURE_AD_CLIENT_ID: undefined,
        AZURE_AD_CLIENT_SECRET: undefined,
        AZURE_AD_TENANT_ID: undefined,
      });
      expect(socialProviders.google).toBeDefined();
      // Credentials must be threaded through from env, not just present.
      const google = socialProviders.google as {
        clientId?: string;
        clientSecret?: string;
      };
      expect(google.clientId).toBe("google-client-id");
      expect(google.clientSecret).toBe("google-client-secret");
    });
  });

  describe("SSO precedence — re-login must not overwrite an uploaded avatar", () => {
    // A user-uploaded avatar (User.image) must survive later SSO sign-ins.
    // better-auth's `mapProfileToUser` runs only on user *create*; it overwrites
    // profile fields on subsequent sign-ins ONLY if a provider opts in (e.g.
    // `overrideUserInfoOnSignIn: true`). Lock that no provider ever does — the
    // check is name-agnostic so any future override/update-user-info flag set to
    // `true` trips it. Spec: specs/settings/user-avatar.feature
    const overrideFlags = (config: unknown): string[] =>
      Object.entries(config as Record<string, unknown>)
        .filter(([k, v]) => /override|updateuserinfo/i.test(k) && v === true)
        .map(([k]) => k);

    const noSocialEnv = {
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
      GITLAB_CLIENT_ID: undefined,
      GITLAB_CLIENT_SECRET: undefined,
      AZURE_AD_CLIENT_ID: undefined,
      AZURE_AD_CLIENT_SECRET: undefined,
      AZURE_AD_TENANT_ID: undefined,
    };

    it.each([
      [
        "google",
        "google",
        { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" },
      ],
      [
        "github",
        "github",
        { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" },
      ],
      [
        "gitlab",
        "gitlab",
        { GITLAB_CLIENT_ID: "id", GITLAB_CLIENT_SECRET: "secret" },
      ],
      [
        "microsoft",
        "azure-ad",
        {
          AZURE_AD_CLIENT_ID: "id",
          AZURE_AD_CLIENT_SECRET: "secret",
          AZURE_AD_TENANT_ID: "tenant",
        },
      ],
    ])("social provider %s never overwrites profile info on sign-in", async (_label, provider, creds) => {
      const { buildSocialProviders } = await import("@ee/sso/providers");
      const providers = buildSocialProviders({
        ...noSocialEnv,
        NEXTAUTH_PROVIDER: provider,
        ...creds,
      } as Parameters<typeof buildSocialProviders>[0]);
      const built = Object.values(providers);
      expect(built).toHaveLength(1);
      expect(overrideFlags(built[0])).toEqual([]);
    });

    it("generic-oauth (auth0/okta) never overwrites profile info on sign-in", async () => {
      const { buildGenericOAuthConfigs } = await import("@ee/sso/providers");
      const configs = buildGenericOAuthConfigs({
        NEXTAUTH_PROVIDER: "auth0",
        AUTH0_CLIENT_ID: "id",
        AUTH0_CLIENT_SECRET: "secret",
        AUTH0_ISSUER: "tenant.us.auth0.com",
        OKTA_CLIENT_ID: undefined,
        OKTA_CLIENT_SECRET: undefined,
        OKTA_ISSUER: undefined,
        NEXTAUTH_URL: "http://localhost:3000",
      });
      expect(configs.length).toBeGreaterThan(0);
      for (const config of configs) {
        expect(overrideFlags(config)).toEqual([]);
      }
    });
  });
});
