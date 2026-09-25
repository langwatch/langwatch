// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SignInProviderMounts } from "@langwatch/enterprise-sso-contract";
import { describe, expect, it } from "vitest";

import { createSsoTestApp, createSsoTestConfig } from "./sso.fixture.ts";

const BETTER_AUTH_URL = "https://app.langwatch.test";

function mountedIds(mounts: SignInProviderMounts): string[] {
  return [
    ...Object.keys(mounts.socialProviders),
    ...mounts.genericOAuthConfigs.map((config) => config.providerId),
  ];
}

async function mountsFor(
  config: Parameters<typeof createSsoTestConfig>[0],
  secrets: NonNullable<Parameters<typeof createSsoTestApp>[0]>["secrets"] = {},
): Promise<SignInProviderMounts> {
  const app = await createSsoTestApp({
    config: createSsoTestConfig({ auth0ClientId: undefined, auth0Issuer: undefined, ...config }),
    secrets: { auth0ClientSecret: undefined, ...secrets },
  });
  return app.getSignInProviderMounts({ baseUrl: BETTER_AUTH_URL });
}

describe("getSignInProviderMounts", () => {
  describe("given a deployment that names no sign-in provider", () => {
    /** @scenario "A deployment that names no provider mounts none" */
    it("answers no social or enterprise provider", async () => {
      expect(mountedIds(await mountsFor({ authProvider: "email" }))).toEqual([]);
    });
  });

  describe("given a named provider with its registration", () => {
    it.each([
      {
        provider: "google",
        config: { googleClientId: "google-id" },
        secrets: { googleClientSecret: "s" },
      },
      {
        provider: "github",
        config: { githubClientId: "github-id" },
        secrets: { githubClientSecret: "s" },
      },
    ])("answers $provider as a social provider", async ({ provider, config, secrets }) => {
      const mounts = await mountsFor({ authProvider: provider, ...config }, secrets);

      expect(mountedIds(mounts)).toEqual([provider]);
    });

    /** @scenario "A named provider with its credentials mounts on Better Auth" */
    it("answers auth0 on the legacy callback under Better Auth's URL, pinned and verified", async () => {
      const mounts = await mountsFor(
        {
          authProvider: "auth0",
          auth0ClientId: "auth0-id",
          auth0Issuer: "https://tenant.auth0.test/",
        },
        { auth0ClientSecret: "auth0-secret" },
      );

      expect(mounts.genericOAuthConfigs).toMatchObject([
        {
          providerId: "auth0",
          clientSecret: "auth0-secret",
          accountIssuer: "local:oauth:auth0",
          requireIdTokenVerification: true,
          redirectURI: `${BETTER_AUTH_URL}/api/auth/callback/auth0`,
        },
      ]);
    });

    /** @scenario "A named provider without its secret mounts nothing" */
    it("answers nothing when the named provider's secret is missing", async () => {
      const mounts = await mountsFor({ authProvider: "google", googleClientId: "google-id" });

      expect(mountedIds(mounts)).toEqual([]);
    });
  });

  describe("given a deployment outside email mode with several providers' credentials set", () => {
    /** @scenario "Every social provider with credentials mounts outside email mode" */
    it("answers every social provider beside the named one", async () => {
      const mounts = await mountsFor(
        {
          authProvider: "auth0",
          auth0ClientId: "auth0-id",
          auth0Issuer: "https://tenant.auth0.test/",
          googleClientId: "google-id",
          githubClientId: "github-id",
        },
        { auth0ClientSecret: "a", googleClientSecret: "g", githubClientSecret: "h" },
      );

      expect(mountedIds(mounts)).toEqual(["google", "github", "auth0"]);
    });
  });

  describe("given a deployment in email mode with social credentials lingering", () => {
    /** @scenario "Email mode mounts no social provider whatever credentials linger" */
    it("answers none of them", async () => {
      const mounts = await mountsFor(
        { authProvider: "email", googleClientId: "google-id" },
        { googleClientSecret: "g" },
      );

      expect(mountedIds(mounts)).toEqual([]);
    });
  });
});
