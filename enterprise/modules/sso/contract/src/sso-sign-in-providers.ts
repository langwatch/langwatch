// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which sign-in providers this deployment configured, decided over config and
 * credentials alone: auth mounts exactly these on Better Auth, sso reports
 * whether the named one mounted. main's ee/sso/providers.ts, D09 included.
 */
import { signInProviderSecrets } from "@langwatch/secrets";
import type { SecretHandle } from "@langwatch/secrets/secret";

import type { SsoConfig, SsoConfiguration } from "./sso.config.ts";

export type SignInProviderConfiguration = Omit<SsoConfiguration, "isSaas">;

export type SocialProviderConfiguration = Pick<
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

/** Per-provider credentials are optional: a deployment configures one identity provider. */
export type GenericOAuthConfiguration = Pick<
  SsoConfiguration,
  | "provider"
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

export type ConfiguredSocialProvider =
  | Readonly<{ key: "google" | "github" | "gitlab"; clientId: string; clientSecret: string }>
  | Readonly<{ key: "microsoft"; clientId: string; clientSecret: string; tenantId: string }>;

export type ConfiguredGenericOAuthProvider = Readonly<{
  providerId: string;
  issuerEnvName: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
}>;

/** Better Auth's key for each social provider, and the id the product dials, in rail order. */
const SOCIAL_PROVIDER_METHOD_IDS: readonly (readonly [ConfiguredSocialProvider["key"], string])[] =
  [
    ["google", "google"],
    ["github", "github"],
    ["gitlab", "gitlab"],
    ["microsoft", "azure-ad"],
  ];

/**
 * Providers that need nothing but a client id, a secret and an OIDC issuer;
 * every endpoint comes from the issuer's discovery document. Auth0 and Okta go
 * through Better Auth's own helpers instead, each with a quirk of its own.
 */
export const PLAIN_OIDC_PROVIDERS = [
  {
    providerId: "cognito",
    issuerEnvName: "COGNITO_ISSUER",
    // The user pool's own issuer (`https://cognito-idp.<region>.amazonaws.com/<userPoolId>`), not the hosted-UI domain.
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
    // Any other OpenID Connect identity provider; the named rows above are this with a name on it.
    providerId: "oidc",
    issuerEnvName: "OIDC_ISSUER",
    credentials: (configuration: GenericOAuthConfiguration) => ({
      clientId: configuration.oidcClientId,
      clientSecret: configuration.oidcClientSecret,
      issuer: configuration.oidcIssuer,
    }),
  },
] as const;

const GENERIC_OAUTH_PROVIDERS = [
  {
    providerId: "auth0",
    issuerEnvName: "AUTH0_ISSUER",
    credentials: (configuration: GenericOAuthConfiguration) => ({
      clientId: configuration.auth0ClientId,
      clientSecret: configuration.auth0ClientSecret,
      issuer: configuration.auth0Issuer,
    }),
  },
  {
    providerId: "okta",
    issuerEnvName: "OKTA_ISSUER",
    credentials: (configuration: GenericOAuthConfiguration) => ({
      clientId: configuration.oktaClientId,
      clientSecret: configuration.oktaClientSecret,
      issuer: configuration.oktaIssuer,
    }),
  },
  ...PLAIN_OIDC_PROVIDERS,
] as const;

/**
 * D09: outside email mode, every social provider whose credentials are set
 * mounts; the credentials are the operator's intent. Email mode mounts none,
 * whatever credentials linger (ADR-027's DENY).
 */
export function findConfiguredSocialProviders(
  configuration: SocialProviderConfiguration,
): ConfiguredSocialProvider[] {
  if (!configuration.provider || configuration.provider === "email") return [];
  const {
    googleClientId,
    googleClientSecret,
    githubClientId,
    githubClientSecret,
    gitlabClientId,
    gitlabClientSecret,
    azureAdClientId,
    azureAdClientSecret,
    azureAdTenantId,
  } = configuration;
  const configured: ConfiguredSocialProvider[] = [];
  if (googleClientId && googleClientSecret) {
    configured.push({ key: "google", clientId: googleClientId, clientSecret: googleClientSecret });
  }
  if (githubClientId && githubClientSecret) {
    configured.push({ key: "github", clientId: githubClientId, clientSecret: githubClientSecret });
  }
  if (gitlabClientId && gitlabClientSecret) {
    configured.push({ key: "gitlab", clientId: gitlabClientId, clientSecret: gitlabClientSecret });
  }
  if (azureAdClientId && azureAdClientSecret && azureAdTenantId) {
    configured.push({
      key: "microsoft",
      clientId: azureAdClientId,
      clientSecret: azureAdClientSecret,
      tenantId: azureAdTenantId,
    });
  }
  return configured;
}

/** The generic-OAuth provider the deployment named, when its credentials are all set. */
export function findConfiguredGenericOAuthProviders(
  configuration: GenericOAuthConfiguration,
): ConfiguredGenericOAuthProvider[] {
  return GENERIC_OAUTH_PROVIDERS.filter(
    (provider) => provider.providerId === configuration.provider,
  ).flatMap(({ providerId, issuerEnvName, credentials }) => {
    const { clientId, clientSecret, issuer } = credentials(configuration);
    return clientId && clientSecret && issuer
      ? [{ providerId, issuerEnvName, clientId, clientSecret, issuer }]
      : [];
  });
}

/**
 * Whether the NAMED provider mounted, not merely any provider: a deployment
 * naming one this build cannot mount lands in email mode even while another
 * social provider's credentials are set. main's `authProviderIsMounted`.
 */
export function isNamedProviderMounted(
  configuration: SocialProviderConfiguration & GenericOAuthConfiguration,
): boolean {
  const namedSocialKey = SOCIAL_PROVIDER_METHOD_IDS.find(
    ([, methodId]) => methodId === configuration.provider,
  )?.[0];
  if (namedSocialKey !== undefined) {
    return findConfiguredSocialProviders(configuration).some(({ key }) => key === namedSocialKey);
  }
  return findConfiguredGenericOAuthProviders(configuration).length > 0;
}

/**
 * The sign-in provider under its supported name (#8143). `AUTH_PROVIDER` wins;
 * the NextAuth-era `NEXTAUTH_PROVIDER` still applies but is deprecated, so a
 * running install is never broken by the rename; neither set means email.
 */
export function configuredAuthProvider({
  authProvider,
  legacyProvider,
}: {
  authProvider: string | undefined;
  legacyProvider: string | undefined;
}): { provider: string; deprecatedNameUsed: boolean } {
  if (authProvider) return { provider: authProvider, deprecatedNameUsed: false };
  if (legacyProvider) return { provider: legacyProvider, deprecatedNameUsed: true };
  return { provider: "email", deprecatedNameUsed: false };
}

type SecretInto = <Value, Out>(
  handle: SecretHandle<Value>,
  build: (value: Value) => Out | Promise<Out>,
) => Promise<Out>;

/** Every provider's public half from `config`, its secret through `into`, the callback base from `baseUrl`. */
export async function resolveSignInProviders({
  config,
  into,
  baseUrl,
}: {
  config: SsoConfig;
  into: SecretInto;
  baseUrl: string;
}): Promise<SignInProviderConfiguration> {
  const [
    googleClientSecret,
    githubClientSecret,
    gitlabClientSecret,
    azureAdClientSecret,
    auth0ClientSecret,
    oktaClientSecret,
    cognitoClientSecret,
    oneLoginClientSecret,
    oidcClientSecret,
  ] = await Promise.all([
    into(signInProviderSecrets.googleClientSecret, (value) => value),
    into(signInProviderSecrets.githubClientSecret, (value) => value),
    into(signInProviderSecrets.gitlabClientSecret, (value) => value),
    into(signInProviderSecrets.azureAdClientSecret, (value) => value),
    into(signInProviderSecrets.auth0ClientSecret, (value) => value),
    into(signInProviderSecrets.oktaClientSecret, (value) => value),
    into(signInProviderSecrets.cognitoClientSecret, (value) => value),
    into(signInProviderSecrets.oneLoginClientSecret, (value) => value),
    into(signInProviderSecrets.oidcClientSecret, (value) => value),
  ]);
  const { authProvider: _named, legacyProvider: _legacy, ...publicHalves } = config;

  return {
    ...publicHalves,
    provider: configuredAuthProvider(config).provider,
    baseUrl,
    googleClientSecret,
    githubClientSecret,
    gitlabClientSecret,
    azureAdClientSecret,
    auth0ClientSecret,
    oktaClientSecret,
    cognitoClientSecret,
    oneLoginClientSecret,
    oidcClientSecret,
  };
}
