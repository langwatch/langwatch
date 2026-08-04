// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Identity-provider wiring for enterprise SSO: the BetterAuth
 * `socialProviders` map (Google, GitHub, GitLab, Azure AD) and the
 * genericOAuth configs (Auth0, Okta). `src/server/better-auth/index.ts` is
 * the assembly point that feeds these into `betterAuth()`; the federation
 * capability itself lives here, under the Enterprise license, alongside the
 * gate (`sso-gate.ts`) that decides whether a deployment may use it.
 */

import type { BetterAuthOptions } from "better-auth";
import {
  auth0,
  type genericOAuth,
  okta,
} from "better-auth/plugins/generic-oauth";
import type { env } from "~/env.mjs";

/**
 * Derives a user display name from an OAuth profile, falling back through
 * progressively less-preferred fields. BetterAuth's base User schema requires
 * `name: string` (non-nullable), but many providers return profiles with
 * `name: null` for users who never set a display name — GitHub falls back to
 * `login`, GitLab to `username`, Auth0 to `nickname`. If all of those are
 * missing, we use the email prefix as a last resort.
 *
 * Exported for unit testing.
 */
export const fallbackName = (profile: Record<string, any>): string => {
  return (
    (typeof profile.name === "string" && profile.name.trim()) ||
    (typeof profile.nickname === "string" && profile.nickname.trim()) ||
    (typeof profile.displayName === "string" && profile.displayName.trim()) ||
    (typeof profile.login === "string" && profile.login.trim()) ||
    (typeof profile.username === "string" && profile.username.trim()) ||
    (typeof profile.preferred_username === "string" &&
      profile.preferred_username.trim()) ||
    (typeof profile.email === "string" && profile.email.split("@")[0]) ||
    "User"
  );
};

/**
 * Subset of env needed to select and configure a `socialProviders` entry.
 */
type SocialProviderEnv = Pick<
  typeof env,
  | "NEXTAUTH_PROVIDER"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "GITLAB_CLIENT_ID"
  | "GITLAB_CLIENT_SECRET"
  | "AZURE_AD_CLIENT_ID"
  | "AZURE_AD_CLIENT_SECRET"
  | "AZURE_AD_TENANT_ID"
>;

/**
 * Builds BetterAuth's `socialProviders` map from environment configuration.
 * Mirrors the original NextAuth "exactly one provider" behavior: only the
 * provider named by `NEXTAUTH_PROVIDER` is configured, and only when its
 * client credentials are present.
 *
 * Exported for unit testing — lets us exercise google/github/gitlab/azure
 * selection directly, without re-initializing the module under a different
 * `NEXTAUTH_PROVIDER`.
 */
export const buildSocialProviders = (
  e: SocialProviderEnv,
): NonNullable<BetterAuthOptions["socialProviders"]> => {
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};

  if (
    e.NEXTAUTH_PROVIDER === "google" &&
    e.GOOGLE_CLIENT_ID &&
    e.GOOGLE_CLIENT_SECRET
  ) {
    socialProviders.google = {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile as Record<string, any>),
        email: (profile as { email?: string }).email,
        image: (profile as { picture?: string }).picture,
      }),
    };
  }

  if (
    e.NEXTAUTH_PROVIDER === "github" &&
    e.GITHUB_CLIENT_ID &&
    e.GITHUB_CLIENT_SECRET
  ) {
    socialProviders.github = {
      clientId: e.GITHUB_CLIENT_ID,
      clientSecret: e.GITHUB_CLIENT_SECRET,
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile as Record<string, any>),
        email: (profile as { email?: string }).email,
        image: (profile as { avatar_url?: string }).avatar_url,
      }),
    };
  }

  if (
    e.NEXTAUTH_PROVIDER === "gitlab" &&
    e.GITLAB_CLIENT_ID &&
    e.GITLAB_CLIENT_SECRET
  ) {
    socialProviders.gitlab = {
      clientId: e.GITLAB_CLIENT_ID,
      clientSecret: e.GITLAB_CLIENT_SECRET,
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile as Record<string, any>),
        email: (profile as { email?: string }).email,
        image: (profile as { avatar_url?: string }).avatar_url,
      }),
    };
  }

  if (
    e.NEXTAUTH_PROVIDER === "azure-ad" &&
    e.AZURE_AD_CLIENT_ID &&
    e.AZURE_AD_CLIENT_SECRET &&
    e.AZURE_AD_TENANT_ID
  ) {
    socialProviders.microsoft = {
      clientId: e.AZURE_AD_CLIENT_ID,
      clientSecret: e.AZURE_AD_CLIENT_SECRET,
      tenantId: e.AZURE_AD_TENANT_ID,
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile as Record<string, any>),
        email:
          (
            profile as {
              email?: string;
              mail?: string;
              userPrincipalName?: string;
            }
          ).email ??
          (profile as { mail?: string }).mail ??
          (profile as { userPrincipalName?: string }).userPrincipalName,
      }),
    };
  }

  return socialProviders;
};

/**
 * Forgiving issuer URL parser. Accepts:
 *   - `https://tenant.us.auth0.com/`
 *   - `https://tenant.us.auth0.com` (no trailing slash)
 *   - `tenant.us.auth0.com` (no scheme — auto-prepends https://)
 *
 * Throws a clear error message if the issuer is unparseable, instead of
 * the cryptic native `TypeError: Invalid URL` that crashes deep in the
 * Next.js instrumentation hook with no indication that the OAuth issuer
 * env var is the cause.
 *
 * Exported for unit testing.
 */
export const parseIssuerUrl = (issuer: string, envName: string): URL => {
  const normalized = /^https?:\/\//i.test(issuer)
    ? issuer
    : `https://${issuer}`;
  try {
    return new URL(normalized);
  } catch {
    throw new Error(
      `Invalid ${envName}: "${issuer}" is not a valid URL. Expected something like "https://tenant.us.auth0.com/".`,
    );
  }
};

/**
 * Subset of env needed to select and configure a generic-OAuth provider.
 */
type GenericOAuthEnv = Pick<
  typeof env,
  | "NEXTAUTH_PROVIDER"
  | "AUTH0_CLIENT_ID"
  | "AUTH0_CLIENT_SECRET"
  | "AUTH0_ISSUER"
  | "OKTA_CLIENT_ID"
  | "OKTA_CLIENT_SECRET"
  | "OKTA_ISSUER"
  | "NEXTAUTH_URL"
>;

/**
 * Builds the BetterAuth genericOAuth `config` array from environment
 * configuration. Only the provider named by `NEXTAUTH_PROVIDER` is added, and
 * only when its credentials are present. Each entry carries a `providerId`
 * (`"auth0"` / `"okta"`) so the genericOAuth plugin registers it under that id.
 *
 * Exported for unit testing — lets us assert auth0/okta provider selection
 * directly, without re-initializing the module under a different
 * `NEXTAUTH_PROVIDER`.
 */
export const buildGenericOAuthConfigs = (
  e: GenericOAuthEnv,
): Parameters<typeof genericOAuth>[0]["config"] => {
  const genericOAuthConfigs: Parameters<typeof genericOAuth>[0]["config"] = [];

  if (
    e.NEXTAUTH_PROVIDER === "auth0" &&
    e.AUTH0_CLIENT_ID &&
    e.AUTH0_CLIENT_SECRET &&
    e.AUTH0_ISSUER
  ) {
    const issuerUrl = parseIssuerUrl(e.AUTH0_ISSUER, "AUTH0_ISSUER");
    genericOAuthConfigs.push({
      ...auth0({
        clientId: e.AUTH0_CLIENT_ID,
        clientSecret: e.AUTH0_CLIENT_SECRET,
        domain: issuerUrl.host,
      }),
      // The `prompt=login` forces Auth0 to always show the login screen
      // instead of silently using an existing session — matches the original
      // NextAuth Auth0Provider behavior (`authorization: { params: { prompt: "login" } }`).
      authorizationUrlParams: { prompt: "login" },
      // Pin the OAuth `redirect_uri` to the LEGACY NextAuth callback path
      // (`/api/auth/callback/auth0`). BetterAuth's genericOAuth plugin
      // defaults to `/api/auth/oauth2/callback/auth0`, but existing customer
      // Auth0 applications have only the legacy path registered as an
      // allowed callback. Sending a different `redirect_uri` would cause
      // Auth0 to reject the authorization request.
      // The legacy path is wired back to BetterAuth's plugin handler via
      // a Next.js rewrite in `next.config.mjs`.
      redirectURI: `${e.NEXTAUTH_URL}/api/auth/callback/auth0`,
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile),
        email: profile.email,
        image: profile.picture,
      }),
    });
  }

  if (
    e.NEXTAUTH_PROVIDER === "okta" &&
    e.OKTA_CLIENT_ID &&
    e.OKTA_CLIENT_SECRET &&
    e.OKTA_ISSUER
  ) {
    // Normalize issuer to a full URL — BetterAuth's okta helper builds the
    // discovery URL by string concatenation and would otherwise fail
    // silently at first sign-in if the issuer has no scheme.
    const oktaIssuerUrl = parseIssuerUrl(e.OKTA_ISSUER, "OKTA_ISSUER");
    genericOAuthConfigs.push({
      ...okta({
        clientId: e.OKTA_CLIENT_ID,
        clientSecret: e.OKTA_CLIENT_SECRET,
        issuer: oktaIssuerUrl.toString().replace(/\/$/, ""),
      }),
      // Same backward-compat reasoning as auth0 above — pin the legacy
      // NextAuth callback path so existing Okta applications don't need
      // their allowed callback list updated during cutover.
      redirectURI: `${e.NEXTAUTH_URL}/api/auth/callback/okta`,
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile),
        email: profile.email,
        image: profile.image ?? profile.picture,
      }),
    });
  }

  return genericOAuthConfigs;
};
