// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Identity-provider wiring for enterprise SSO: the BetterAuth
 * `socialProviders` map (Google, GitHub, GitLab, Azure AD) and the
 * genericOAuth configs (Auth0, Okta, AWS Cognito, OneLogin, and any other
 * OpenID Connect provider).
 * `src/server/better-auth/index.ts` is
 * the assembly point that feeds these into `betterAuth()`; the federation
 * capability itself lives here, under the Enterprise license, alongside the
 * gate (`sso-gate.ts`) that decides whether a deployment may use it.
 */

import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
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
 * The avatar an identity provider claims, but only where it claimed a string.
 *
 * `picture` is whatever the provider chose to put in the token — some send an
 * object, some send null, some omit it. It lands in a `String?` column either
 * way, so anything else is a write that either throws or stores `"[object
 * Object]"` as somebody's avatar URL. better-auth 1.7 types the mapped `image`
 * as `string | undefined` and made that visible; the coercion is the fix, not
 * the cast that would silence it.
 *
 * Exported for unit testing.
 */
export const profileImage = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : void 0;

/**
 * True when an Auth0 `sub` identifies a user who authenticated through a SAML
 * connection. Auth0 encodes the connection strategy as the first
 * pipe-delimited segment of `sub` (`{strategy}|{connection}|{id}`); SAML
 * users arrive as `samlp|…`. The trailing pipe is part of the prefix so a
 * hypothetical `samlpx` strategy never matches, and the prefix cannot be
 * forged from other connection types — a database user_id of `samlp|x`
 * yields the sub `auth0|samlp|x`.
 *
 * Used to mark SAML sign-ins as email-verified (ADR-096): Auth0 reports
 * `email_verified: false` for every SAML connection with no way to change
 * it, which would block BetterAuth from linking the sign-in to an existing
 * user. Trust boundary: this assumes every SAML connection in the Auth0
 * tenant maps `email` from an attribute the IdP controls — an operator who
 * points a SAML connection at an IdP with user-editable emails or open
 * registration re-opens the account-linking hole this flag closes.
 *
 * Exported for unit testing.
 */
export const isSamlSub = (sub: unknown): boolean =>
  typeof sub === "string" && sub.startsWith("samlp|");

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
 * The callback URL an operator registers with their identity provider. One
 * shape for every provider we document, which is the whole reason the legacy
 * path is pinned rather than left at the plugin default.
 *
 * Identity providers compare redirect URIs by exact string, so a trailing
 * slash on the base URL is not cosmetic: it would send
 * `https://host//api/auth/callback/x` against a registration of
 * `https://host/api/auth/callback/x` and the provider would refuse the
 * request.
 */
export const legacyCallbackUrl = ({
  baseUrl,
  providerId,
}: {
  baseUrl: string;
  providerId: string;
}): string => `${baseUrl.replace(/\/+$/, "")}/api/auth/callback/${providerId}`;

/**
 * Discovery URL for an OpenID Connect issuer. Normalizes the issuer first, so
 * an operator who omits the scheme or leaves a trailing slash still gets a
 * well-formed URL rather than a 404 at first sign-in.
 *
 * Exported for unit testing.
 */
export const discoveryUrlFor = (issuer: string, envName: string): string => {
  const issuerUrl = parseIssuerUrl(issuer, envName);
  return `${issuerUrl.toString().replace(/\/$/, "")}/.well-known/openid-configuration`;
};

/**
 * A plain OIDC provider configured from nothing but a client id, a secret and
 * an issuer. Every endpoint comes from the issuer's discovery document, which
 * is what lets Cognito work without asking the operator for the hosted-UI
 * domain separately: Cognito publishes that domain as the
 * `authorization_endpoint` of the user pool's discovery document.
 *
 * `redirectURI` is pinned to `/api/auth/callback/<providerId>` so that every
 * provider in the self-hosting docs registers the same shape of callback URL.
 * BetterAuth serves that path because the plugin registers each config in
 * `ctx.socialProviders`, which is what the core callback route resolves
 * against — and since better-auth 1.7 that core route is the only callback
 * there is, the plugin having stopped mounting one of its own.
 *
 * Exported for unit testing.
 */
export const oidcProviderConfig = ({
  providerId,
  clientId,
  clientSecret,
  issuer,
  issuerEnvName,
  baseUrl,
}: {
  providerId: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
  issuerEnvName: string;
  baseUrl: string;
}): NonNullable<Parameters<typeof genericOAuth>[0]["config"]>[number] => ({
  providerId,
  clientId,
  clientSecret,
  discoveryUrl: discoveryUrlFor(issuer, issuerEnvName),
  scopes: ["openid", "email", "profile"],
  pkce: true,
  redirectURI: legacyCallbackUrl({ baseUrl, providerId }),
  mapProfileToUser: (profile) => ({
    name: fallbackName(profile),
    email: profile.email,
    image: profileImage(profile.picture),
  }),
});

/**
 * Subset of env needed to select and configure a generic-OAuth provider.
 *
 * Only the two fields every provider needs are required. The per-provider
 * credentials are optional because they genuinely are: a deployment configures
 * exactly one identity provider and leaves the rest unset. Requiring them all
 * would also mean every caller has to be edited each time a provider is added,
 * which is churn that proves nothing.
 */
type GenericOAuthEnv = Pick<typeof env, "NEXTAUTH_PROVIDER" | "NEXTAUTH_URL"> &
  Partial<
    Pick<
      typeof env,
      | "AUTH0_CLIENT_ID"
      | "AUTH0_CLIENT_SECRET"
      | "AUTH0_ISSUER"
      | "OKTA_CLIENT_ID"
      | "OKTA_CLIENT_SECRET"
      | "OKTA_ISSUER"
      | "COGNITO_CLIENT_ID"
      | "COGNITO_CLIENT_SECRET"
      | "COGNITO_ISSUER"
      | "ONELOGIN_CLIENT_ID"
      | "ONELOGIN_CLIENT_SECRET"
      | "ONELOGIN_ISSUER"
      | "OIDC_CLIENT_ID"
      | "OIDC_CLIENT_SECRET"
      | "OIDC_ISSUER"
    >
  >;

/**
 * Providers that need nothing but a client id, a secret and an OIDC issuer,
 * with every endpoint coming from the issuer's discovery document. Adding one
 * is a row here rather than another branch in the builder below.
 *
 * Auth0 and Okta are not in this table: they go through BetterAuth's own
 * helpers and each carries a quirk of its own (Auth0 forces a fresh login
 * prompt, Okta needs its issuer normalized before the helper concatenates it).
 */
export const PLAIN_OIDC_PROVIDERS = [
  {
    providerId: "cognito",
    issuerEnvName: "COGNITO_ISSUER",
    // The issuer is the user pool's own
    // (`https://cognito-idp.<region>.amazonaws.com/<userPoolId>`), not the
    // hosted-UI domain. The domain is what its discovery document points at.
    credentials: (e: GenericOAuthEnv) => ({
      clientId: e.COGNITO_CLIENT_ID,
      clientSecret: e.COGNITO_CLIENT_SECRET,
      issuer: e.COGNITO_ISSUER,
    }),
  },
  {
    providerId: "onelogin",
    issuerEnvName: "ONELOGIN_ISSUER",
    // `https://<subdomain>.onelogin.com/oidc/2`
    credentials: (e: GenericOAuthEnv) => ({
      clientId: e.ONELOGIN_CLIENT_ID,
      clientSecret: e.ONELOGIN_CLIENT_SECRET,
      issuer: e.ONELOGIN_ISSUER,
    }),
  },
  {
    // Any other OpenID Connect identity provider. Everything above is this
    // with a name on it: the named entries exist because operators look for
    // their provider by name and each has setup steps worth documenting, not
    // because the wiring differs. Anyone whose IdP is not listed configures it
    // here rather than having to claim it is one of the others.
    providerId: "oidc",
    issuerEnvName: "OIDC_ISSUER",
    credentials: (e: GenericOAuthEnv) => ({
      clientId: e.OIDC_CLIENT_ID,
      clientSecret: e.OIDC_CLIENT_SECRET,
      issuer: e.OIDC_ISSUER,
    }),
  },
] as const;

/**
 * Every generic-OAuth provider whose `redirectURI` is pinned to
 * `/api/auth/callback/<providerId>` — the path customer IdPs have registered
 * as an allowed callback, and the one the self-hosting docs tell operators to
 * register.
 *
 * It used to be the LEGACY path, opposite the genericOAuth plugin's own
 * `/api/auth/oauth2/callback/<providerId>`, and `createApiRouter` rewrote one
 * to the other from this list. better-auth 1.7 removed the plugin's endpoints
 * — every config is a first-class social provider now — so the core callback
 * answers this path directly and the rewrite is gone. The list stays because
 * the PIN is still the thing that has to hold: `legacyCallbackParity.test.ts`
 * checks every id here builds a config pinned to it, and that every row of the
 * OIDC table appears here. A provider that drifts sends its IdP somewhere
 * nobody registered, and only that provider's sign-in breaks.
 *
 * Derived from the table above rather than restated, so adding a row is enough.
 * Auth0 and Okta are listed by hand because they are hand-coded branches.
 */
export const LEGACY_CALLBACK_PROVIDER_IDS: readonly string[] = [
  "auth0",
  "okta",
  ...PLAIN_OIDC_PROVIDERS.map((provider) => provider.providerId),
];

/**
 * Builds the BetterAuth genericOAuth `config` array from environment
 * configuration. Only the provider named by `NEXTAUTH_PROVIDER` is added, and
 * only when its credentials are present. Each entry carries the `providerId`
 * that `NEXTAUTH_PROVIDER` named, so the genericOAuth plugin registers it
 * under that id: `auth0` and `okta` below, then every row of
 * `PLAIN_OIDC_PROVIDERS`.
 *
 * Exported for unit testing, so provider selection can be asserted directly
 * without re-initializing the module under a different `NEXTAUTH_PROVIDER`.
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
      // Pin the OAuth `redirect_uri` to the NextAuth-era callback path
      // (`/api/auth/callback/auth0`): existing customer Auth0 applications
      // have only that path registered as an allowed callback, and sending a
      // different `redirect_uri` would cause Auth0 to reject the
      // authorization request outright.
      // BetterAuth serves it because the genericOAuth plugin registers each
      // config in `ctx.socialProviders`, which is what the core callback route
      // resolves against. Before 1.7 the plugin also mounted its own
      // `/api/auth/oauth2/callback/auth0` and this pin was the thing steering
      // round-trips away from it; that endpoint no longer exists.
      redirectURI: legacyCallbackUrl({
        baseUrl: e.NEXTAUTH_URL,
        providerId: "auth0",
      }),
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile),
        email: profile.email,
        image: profileImage(profile.picture),
        // SAML sign-ins count as verified: the email was asserted by the
        // organization's own IdP, but Auth0 reports `email_verified: false`
        // for every SAML connection, which would stop BetterAuth from
        // linking to an existing user (ADR-096). Non-SAML profiles get no
        // `emailVerified` key so the claim-derived value flows through.
        ...(isSamlSub(profile.sub) ? { emailVerified: true } : {}),
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
      redirectURI: legacyCallbackUrl({
        baseUrl: e.NEXTAUTH_URL,
        providerId: "okta",
      }),
      mapProfileToUser: (profile) => ({
        name: fallbackName(profile),
        email: profile.email,
        image: profileImage(profile.image ?? profile.picture),
      }),
    });
  }

  for (const provider of PLAIN_OIDC_PROVIDERS) {
    if (e.NEXTAUTH_PROVIDER !== provider.providerId) continue;

    const { clientId, clientSecret, issuer } = provider.credentials(e);
    if (!clientId || !clientSecret || !issuer) continue;

    genericOAuthConfigs.push(
      oidcProviderConfig({
        providerId: provider.providerId,
        clientId,
        clientSecret,
        issuer,
        issuerEnvName: provider.issuerEnvName,
        baseUrl: e.NEXTAUTH_URL,
      }),
    );
  }

  // Every generic-OAuth account keeps the namespace it already has.
  //
  // better-auth 1.7 re-keys an account from `(providerId, accountId)` to
  // `(issuer, accountId)`, and for a config carrying a `discoveryUrl` it
  // would otherwise adopt the DISCOVERED issuer — `https://tenant.auth0.com/`
  // rather than `auth0`. Every `Account` row we already hold is keyed by the
  // provider id, and `Account` is unique on exactly that pair, so letting the
  // key change under a library upgrade would leave every existing enterprise
  // account unfindable: the callback would look up an issuer no stored row
  // carries, miss, and try to link a second row over the unique index.
  //
  // Pinning is what the option is for — better-auth's own contract calls it
  // the way to "establish a stable account namespace" — and this one is
  // already stable, already unique, and already what our data means. Moving
  // to real issuer URLs is a deliberate re-keying with a backfill of its own,
  // not something that should ride along on a version bump.
  //
  // `accountIssuer` beats `discoveryUrl` in the plugin's own precedence
  // (`accountIssuer ?? issuer`), so this holds for auth0, okta and every
  // `PLAIN_OIDC_PROVIDERS` entry without touching their discovery.
  return genericOAuthConfigs.map((config) => ({
    ...config,
    accountIssuer: issuerForProviderId(config.providerId),
  }));
};
