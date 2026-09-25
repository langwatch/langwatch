// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The deployment's sign-in providers as Better Auth mounts them: the social map
 * and the genericOAuth configs. Which ones are configured is the sso contract's
 * pure decision; this file shapes each for Better Auth.
 */
import {
  findConfiguredGenericOAuthProviders,
  findConfiguredSocialProviders,
  PLAIN_OIDC_PROVIDERS,
  type GenericOAuthConfiguration,
  type SocialProviderConfiguration,
} from "@langwatch/enterprise-sso-contract/sign-in-providers";
import type { BetterAuthOptions } from "better-auth";
import { auth0, type genericOAuth, okta } from "better-auth/plugins/generic-oauth";

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
/**
 * The avatar an OIDC profile carries, or nothing.
 *
 * better-auth types `picture` as `unknown` on a generic-OAuth profile, because
 * a provider may answer anything there — Auth0 sends a URL string, some IdPs
 * send an object, most SAML connections send nothing at all. `OAuthMappedUser`
 * accepts only a string, so the narrowing happens here rather than at each
 * provider, in the same shape `fallbackNameImplementation` uses.
 */
function pickProfilePicture(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
}

const fallbackNameImplementation = {
  execute(profile: Record<string, unknown>): string {
    return (
      (typeof profile.name === "string" && profile.name.trim()) ||
      (typeof profile.nickname === "string" && profile.nickname.trim()) ||
      (typeof profile.displayName === "string" && profile.displayName.trim()) ||
      (typeof profile.login === "string" && profile.login.trim()) ||
      (typeof profile.username === "string" && profile.username.trim()) ||
      (typeof profile.preferred_username === "string" && profile.preferred_username.trim()) ||
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

type SocialProviders = NonNullable<BetterAuthOptions["socialProviders"]>;

/** Each configured social provider, with the profile fields its API names. */
const socialProviderImplementation = {
  execute(configuration: SocialProviderConfiguration): SocialProviders {
    const socialProviders: SocialProviders = {};
    for (const provider of findConfiguredSocialProviders(configuration)) {
      if (provider.key === "google") {
        socialProviders.google = {
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          mapProfileToUser: (profile) => ({
            name: fallbackName({ ...profile }),
            email: (profile as { email?: string }).email,
            image: (profile as { picture?: string }).picture,
          }),
        };
      } else if (provider.key === "github") {
        socialProviders.github = {
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          mapProfileToUser: (profile) => ({
            name: fallbackName({ ...profile }),
            email: (profile as { email?: string }).email,
            image: (profile as { avatar_url?: string }).avatar_url,
          }),
        };
      } else if (provider.key === "gitlab") {
        socialProviders.gitlab = {
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          mapProfileToUser: (profile) => ({
            name: fallbackName(profile as Record<string, unknown>),
            email: (profile as { email?: string }).email,
            image: (profile as { avatar_url?: string }).avatar_url,
          }),
        };
      } else if (provider.key === "microsoft") {
        socialProviders.microsoft = {
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          tenantId: provider.tenantId,
          mapProfileToUser: (profile) => ({
            name: fallbackName(profile as Record<string, unknown>),
            email:
              (profile as { email?: string }).email ??
              (profile as { mail?: string }).mail ??
              (profile as { userPrincipalName?: string }).userPrincipalName,
          }),
        };
      }
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
        email: profile.email ?? undefined,
        image: pickProfilePicture(profile.picture),
      }),
    };
  },
};

type GenericOAuthBuildConfiguration = GenericOAuthConfiguration & { baseUrl: string };

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
 * The stored `Account.issuer` namespace for an OAuth provider, restated as a literal
 * because a module may not value-import another's process package (ADR-134).
 */
const OAUTH_ACCOUNT_ISSUER_PREFIX = "local:oauth:";

/**
 * Keeps each account under the namespace its stored rows carry (migration
 * 20260825030000_account_issuer). Auth0 and Okta session MFA evidence comes from the
 * callback ID token, so both refuse to initialize unless discovery supplies issuer and JWKS.
 */
function pinnedToStoredAccountsAndVerifiedTokens(
  config: NonNullable<Parameters<typeof genericOAuth>[0]["config"]>[number],
): NonNullable<Parameters<typeof genericOAuth>[0]["config"]>[number] {
  return {
    ...config,
    accountIssuer: `${OAUTH_ACCOUNT_ISSUER_PREFIX}${encodeURIComponent(config.providerId)}`,
    ...(config.providerId === "auth0" || config.providerId === "okta"
      ? { requireIdTokenVerification: true }
      : {}),
  };
}

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
    configuration: GenericOAuthBuildConfiguration,
  ): Parameters<typeof genericOAuth>[0]["config"] {
    const genericOAuthConfigs: Parameters<typeof genericOAuth>[0]["config"] = [];

    for (const provider of findConfiguredGenericOAuthProviders(configuration)) {
      if (provider.providerId === "auth0") {
        const issuerUrl = BetterAuthSsoAdapter.parseIssuerUrl(
          provider.issuer,
          provider.issuerEnvName,
        );
        genericOAuthConfigs.push({
          ...auth0({
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
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
              image: string | undefined;
              emailVerified?: true;
            } = {
              name: BetterAuthSsoAdapter.fallbackName(profile),
              email: profile.email ?? undefined,
              image: pickProfilePicture(profile.picture),
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
      } else if (provider.providerId === "okta") {
        // Normalize issuer to a full URL — BetterAuth's okta helper builds the
        // discovery URL by string concatenation and would otherwise fail
        // silently at first sign-in if the issuer has no scheme.
        const oktaIssuerUrl = BetterAuthSsoAdapter.parseIssuerUrl(
          provider.issuer,
          provider.issuerEnvName,
        );
        genericOAuthConfigs.push({
          ...okta({
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
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
            email: profile.email ?? undefined,
            image: pickProfilePicture(profile.image, profile.picture),
          }),
        });
      } else {
        genericOAuthConfigs.push(
          BetterAuthSsoAdapter.oidcProviderConfig({
            providerId: provider.providerId,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
            issuer: provider.issuer,
            issuerEnvName: provider.issuerEnvName,
            baseUrl: configuration.baseUrl,
          }),
        );
      }
    }

    return genericOAuthConfigs.map(pinnedToStoredAccountsAndVerifiedTokens);
  },
};

/** BetterAuth-specific Enterprise SSO configuration adapter. */
export function fallbackName(profile: Record<string, unknown>): string {
  return fallbackNameImplementation.execute(profile);
}

export function isSamlSub(sub: unknown): boolean {
  return samlSubjectImplementation.execute(sub);
}

export function buildSocialProviders(
  configuration: SocialProviderConfiguration,
): NonNullable<BetterAuthOptions["socialProviders"]> {
  return socialProviderImplementation.execute(configuration);
}

export function parseIssuerUrl(issuer: string, envName: string): URL {
  return issuerUrlImplementation.parse(issuer, envName);
}

export function legacyCallbackUrl(input: { baseUrl: string; providerId: string }): string {
  return callbackUrlImplementation.build(input);
}

export function discoveryUrlFor(issuer: string, envName: string): string {
  return discoveryUrlImplementation.build(issuer, envName);
}

export function oidcProviderConfig(input: {
  providerId: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
  issuerEnvName: string;
  baseUrl: string;
}): NonNullable<Parameters<typeof genericOAuth>[0]["config"]>[number] {
  return oidcProviderImplementation.build(input);
}

export function buildGenericOAuthConfigs(
  configuration: GenericOAuthBuildConfiguration,
): Parameters<typeof genericOAuth>[0]["config"] {
  return genericOAuthImplementation.build(configuration);
}

const BetterAuthSsoAdapter = {
  fallbackName,
  isSamlSub,
  buildSocialProviders,
  parseIssuerUrl,
  legacyCallbackUrl,
  discoveryUrlFor,
  oidcProviderConfig,
  buildGenericOAuthConfigs,
};
