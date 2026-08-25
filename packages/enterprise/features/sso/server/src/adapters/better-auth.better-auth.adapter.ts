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

import type { BetterAuthOptions } from "better-auth";
import { auth0, type genericOAuth, okta } from "better-auth/plugins/generic-oauth";
import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";

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
const fallbackNameImplementation = {
  execute(profile: Record<string, any>): string {
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
  },
};

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
const samlSubjectImplementation = {
  execute(sub: unknown): boolean {
    return typeof sub === "string" && sub.startsWith("samlp|");
  },
};

/**
 * Subset of env needed to select and configure a `socialProviders` entry.
 */
type SocialProviderConfiguration = Pick<
  SsoConfiguration,
  | "provider"
  | "googleClientId"
  | "googleClientSecret"
  | "githubClientId"
  | "githubClientSecret"
  | "gitlabClientId"
  | "gitlabClientSecret"
  | "azureAdClientId"
  | "azureAdClientSecret"
  | "azureAdTenantId"
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
const socialProviderImplementation = {
  execute(
    configuration: SocialProviderConfiguration,
  ): NonNullable<BetterAuthOptions["socialProviders"]> {
    const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};

    if (
      configuration.provider === "google" &&
      configuration.googleClientId &&
      configuration.googleClientSecret
    ) {
      socialProviders.google = {
        clientId: configuration.googleClientId,
        clientSecret: configuration.googleClientSecret,
        mapProfileToUser: (profile) => ({
          name: fallbackName(profile as Record<string, any>),
          email: (profile as { email?: string }).email,
          image: (profile as { picture?: string }).picture,
        }),
      };
    }

    if (
      configuration.provider === "github" &&
      configuration.githubClientId &&
      configuration.githubClientSecret
    ) {
      socialProviders.github = {
        clientId: configuration.githubClientId,
        clientSecret: configuration.githubClientSecret,
        mapProfileToUser: (profile) => ({
          name: fallbackName(profile as Record<string, any>),
          email: (profile as { email?: string }).email,
          image: (profile as { avatar_url?: string }).avatar_url,
        }),
      };
    }

    if (
      configuration.provider === "gitlab" &&
      configuration.gitlabClientId &&
      configuration.gitlabClientSecret
    ) {
      socialProviders.gitlab = {
        clientId: configuration.gitlabClientId,
        clientSecret: configuration.gitlabClientSecret,
        mapProfileToUser: (profile) => ({
          name: fallbackName(profile as Record<string, any>),
          email: (profile as { email?: string }).email,
          image: (profile as { avatar_url?: string }).avatar_url,
        }),
      };
    }

    if (
      configuration.provider === "azure-ad" &&
      configuration.azureAdClientId &&
      configuration.azureAdClientSecret &&
      configuration.azureAdTenantId
    ) {
      socialProviders.microsoft = {
        clientId: configuration.azureAdClientId,
        clientSecret: configuration.azureAdClientSecret,
        tenantId: configuration.azureAdTenantId,
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
  },
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
const issuerUrlImplementation = {
  parse(issuer: string, envName: string): URL {
    const normalized = /^https?:\/\//i.test(issuer) ? issuer : `https://${issuer}`;
    try {
      return new URL(normalized);
    } catch {
      throw new Error(
        `Invalid ${envName}: "${issuer}" is not a valid URL. Expected something like "https://tenant.us.auth0.com/".`,
      );
    }
  },
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
const callbackUrlImplementation = {
  build({ baseUrl, providerId }: { baseUrl: string; providerId: string }): string {
    return `${baseUrl.replace(/\/+$/, "")}/api/auth/callback/${providerId}`;
  },
};

/**
 * Discovery URL for an OpenID Connect issuer. Normalizes the issuer first, so
 * an operator who omits the scheme or leaves a trailing slash still gets a
 * well-formed URL rather than a 404 at first sign-in.
 *
 * Exported for unit testing.
 */
const discoveryUrlImplementation = {
  build(issuer: string, envName: string): string {
    const issuerUrl = BetterAuthSsoAdapter.parseIssuerUrl(issuer, envName);
    return `${issuerUrl.toString().replace(/\/$/, "")}/.well-known/openid-configuration`;
  },
};

/**
 * A plain OIDC provider configured from nothing but a client id, a secret and
 * an issuer. Every endpoint comes from the issuer's discovery document, which
 * is what lets Cognito work without asking the operator for the hosted-UI
 * domain separately: Cognito publishes that domain as the
 * `authorization_endpoint` of the user pool's discovery document.
 *
 * `redirectURI` is pinned to `/api/auth/callback/<providerId>` rather than the
 * genericOAuth plugin's own `/api/auth/oauth2/callback/<providerId>` so that
 * every provider in the self-hosting docs registers the same shape of callback
 * URL. BetterAuth serves that path because the plugin registers each config in
 * `ctx.socialProviders`, which is what the core callback route resolves against.
 *
 * Exported for unit testing.
 */
const oidcProviderImplementation = {
  build({
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
  }): NonNullable<Parameters<typeof genericOAuth>[0]["config"]>[number] {
    return {
      providerId,
      clientId,
      clientSecret,
      discoveryUrl: BetterAuthSsoAdapter.discoveryUrlFor(issuer, issuerEnvName),
      scopes: ["openid", "email", "profile"],
      pkce: true,
      redirectURI: BetterAuthSsoAdapter.legacyCallbackUrl({ baseUrl, providerId }),
      mapProfileToUser: (profile) => ({
        name: BetterAuthSsoAdapter.fallbackName(profile),
        email: profile.email,
        image: profile.picture,
      }),
    };
  },
};

/**
 * Subset of env needed to select and configure a generic-OAuth provider.
 *
 * Only the two fields every provider needs are required. The per-provider
 * credentials are optional because they genuinely are: a deployment configures
 * exactly one identity provider and leaves the rest unset. Requiring them all
 * would also mean every caller has to be edited each time a provider is added,
 * which is churn that proves nothing.
 */
type GenericOAuthConfiguration = Pick<
  SsoConfiguration,
  | "provider"
  | "baseUrl"
  | "auth0ClientId"
  | "auth0ClientSecret"
  | "auth0Issuer"
  | "oktaClientId"
  | "oktaClientSecret"
  | "oktaIssuer"
  | "cognitoClientId"
  | "cognitoClientSecret"
  | "cognitoIssuer"
  | "oneLoginClientId"
  | "oneLoginClientSecret"
  | "oneLoginIssuer"
  | "oidcClientId"
  | "oidcClientSecret"
  | "oidcIssuer"
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
    credentials: (configuration: GenericOAuthConfiguration) => ({
      clientId: configuration.cognitoClientId,
      clientSecret: configuration.cognitoClientSecret,
      issuer: configuration.cognitoIssuer,
    }),
  },
  {
    providerId: "onelogin",
    issuerEnvName: "ONELOGIN_ISSUER",
    // `https://<subdomain>.onelogin.com/oidc/2`
    credentials: (configuration: GenericOAuthConfiguration) => ({
      clientId: configuration.oneLoginClientId,
      clientSecret: configuration.oneLoginClientSecret,
      issuer: configuration.oneLoginIssuer,
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
    credentials: (configuration: GenericOAuthConfiguration) => ({
      clientId: configuration.oidcClientId,
      clientSecret: configuration.oidcClientSecret,
      issuer: configuration.oidcIssuer,
    }),
  },
] as const;

/**
 * Every generic-OAuth provider whose `redirectURI` is pinned to the legacy
 * `/api/auth/callback/<providerId>` path instead of the genericOAuth plugin's
 * own `/api/auth/oauth2/callback/<providerId>`.
 *
 * `createApiRouter` registers its legacy-callback rewrites from this list, so
 * the two halves cannot drift: a provider that pins the legacy path without a
 * matching rewrite sends its IdP round-trip to better-auth's core social
 * callback instead of the plugin's, which is a second code path nobody chose
 * and which no test would notice, because sign-in still succeeds.
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
const genericOAuthImplementation = {
  build(
    configuration: GenericOAuthConfiguration,
  ): Parameters<typeof genericOAuth>[0]["config"] {
    const genericOAuthConfigs: Parameters<typeof genericOAuth>[0]["config"] = [];

    if (
      configuration.provider === "auth0" &&
      configuration.auth0ClientId &&
      configuration.auth0ClientSecret &&
      configuration.auth0Issuer
    ) {
      const issuerUrl = BetterAuthSsoAdapter.parseIssuerUrl(
        configuration.auth0Issuer,
        "AUTH0_ISSUER",
      );
      genericOAuthConfigs.push({
        ...auth0({
          clientId: configuration.auth0ClientId,
          clientSecret: configuration.auth0ClientSecret,
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
        // BetterAuth serves that path because the genericOAuth plugin registers
        // each config in `ctx.socialProviders`, which is what the core callback
        // route resolves against.
        redirectURI: BetterAuthSsoAdapter.legacyCallbackUrl({
          baseUrl: configuration.baseUrl,
          providerId: "auth0",
        }),
        mapProfileToUser: (profile) => {
          const mapped: {
            name: string;
            email: string | undefined;
            image: string | null | undefined;
            emailVerified?: true;
          } = {
            name: BetterAuthSsoAdapter.fallbackName(profile),
            email: profile.email,
            image: profile.picture,
          };
          // SAML sign-ins count as verified: the email was asserted by the
          // organization's own IdP, but Auth0 reports `email_verified: false`
          // for every SAML connection, which would stop BetterAuth from
          // linking to an existing user (ADR-096). Non-SAML profiles get no
          // `emailVerified` key so the claim-derived value flows through.
          if (BetterAuthSsoAdapter.isSamlSub(profile.sub)) {
            mapped.emailVerified = true;
          }
          return mapped;
        },
      });
    }

    if (
      configuration.provider === "okta" &&
      configuration.oktaClientId &&
      configuration.oktaClientSecret &&
      configuration.oktaIssuer
    ) {
      // Normalize issuer to a full URL — BetterAuth's okta helper builds the
      // discovery URL by string concatenation and would otherwise fail
      // silently at first sign-in if the issuer has no scheme.
      const oktaIssuerUrl = BetterAuthSsoAdapter.parseIssuerUrl(
        configuration.oktaIssuer,
        "OKTA_ISSUER",
      );
      genericOAuthConfigs.push({
        ...okta({
          clientId: configuration.oktaClientId,
          clientSecret: configuration.oktaClientSecret,
          issuer: oktaIssuerUrl.toString().replace(/\/$/, ""),
        }),
        // Same backward-compat reasoning as auth0 above — pin the legacy
        // NextAuth callback path so existing Okta applications don't need
        // their allowed callback list updated during cutover.
        redirectURI: BetterAuthSsoAdapter.legacyCallbackUrl({
          baseUrl: configuration.baseUrl,
          providerId: "okta",
        }),
        mapProfileToUser: (profile) => ({
          name: BetterAuthSsoAdapter.fallbackName(profile),
          email: profile.email,
          image: profile.image ?? profile.picture,
        }),
      });
    }

    for (const provider of PLAIN_OIDC_PROVIDERS) {
      if (configuration.provider !== provider.providerId) continue;

      const { clientId, clientSecret, issuer } = provider.credentials(configuration);
      if (!clientId || !clientSecret || !issuer) continue;

      genericOAuthConfigs.push(
        BetterAuthSsoAdapter.oidcProviderConfig({
          providerId: provider.providerId,
          clientId,
          clientSecret,
          issuer,
          issuerEnvName: provider.issuerEnvName,
          baseUrl: configuration.baseUrl,
        }),
      );
    }

    return genericOAuthConfigs;
  },
};

/** BetterAuth-specific Enterprise SSO configuration adapter. */
export class BetterAuthSsoAdapter {
  private constructor() {}

  static create(): BetterAuthSsoAdapter {
    return new BetterAuthSsoAdapter();
  }

  static fallbackName(profile: Record<string, any>): string {
    return fallbackNameImplementation.execute(profile);
  }

  static isSamlSub(sub: unknown): boolean {
    return samlSubjectImplementation.execute(sub);
  }

  static buildSocialProviders(
    configuration: SocialProviderConfiguration,
  ): NonNullable<BetterAuthOptions["socialProviders"]> {
    return socialProviderImplementation.execute(configuration);
  }

  static parseIssuerUrl(issuer: string, envName: string): URL {
    return issuerUrlImplementation.parse(issuer, envName);
  }

  static legacyCallbackUrl(input: { baseUrl: string; providerId: string }): string {
    return callbackUrlImplementation.build(input);
  }

  static discoveryUrlFor(issuer: string, envName: string): string {
    return discoveryUrlImplementation.build(issuer, envName);
  }

  static oidcProviderConfig(input: {
    providerId: string;
    clientId: string;
    clientSecret: string;
    issuer: string;
    issuerEnvName: string;
    baseUrl: string;
  }): NonNullable<Parameters<typeof genericOAuth>[0]["config"]>[number] {
    return oidcProviderImplementation.build(input);
  }

  static buildGenericOAuthConfigs(
    configuration: GenericOAuthConfiguration,
  ): Parameters<typeof genericOAuth>[0]["config"] {
    return genericOAuthImplementation.build(configuration);
  }
}

// Compatibility values preserve the existing call sites while keeping the
// implementation and construction surface on the adapter class.
export const fallbackName = BetterAuthSsoAdapter.fallbackName;
export const isSamlSub = BetterAuthSsoAdapter.isSamlSub;
export const buildSocialProviders = BetterAuthSsoAdapter.buildSocialProviders;
export const parseIssuerUrl = BetterAuthSsoAdapter.parseIssuerUrl;
export const legacyCallbackUrl = BetterAuthSsoAdapter.legacyCallbackUrl;
export const discoveryUrlFor = BetterAuthSsoAdapter.discoveryUrlFor;
export const oidcProviderConfig = BetterAuthSsoAdapter.oidcProviderConfig;
export const buildGenericOAuthConfigs = BetterAuthSsoAdapter.buildGenericOAuthConfigs;
