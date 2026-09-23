// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Deployment facts (ADR-132): which provider `AUTH_PROVIDER` names (the
 * deprecated `NEXTAUTH_PROVIDER` still read beside it), and
 * the public half of each identity provider's OAuth registration — a client
 * id and an issuer are not credentials. Every `*ClientSecret` resolves through
 * `ssoSecrets`; the platform license key is licensing's, asked through its API.
 */
import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

const publicField = z.string().min(1).optional();

export const ssoConfig = Config.define((c) => ({
  authProvider: c.env("AUTH_PROVIDER", z.string().min(1).optional()),
  /** The NextAuth-era name for `AUTH_PROVIDER`: deprecated, still applied. */
  legacyProvider: c.env("NEXTAUTH_PROVIDER", z.string().min(1).optional()),
  googleClientId: c.env("GOOGLE_CLIENT_ID", publicField),
  githubClientId: c.env("GITHUB_CLIENT_ID", publicField),
  gitlabClientId: c.env("GITLAB_CLIENT_ID", publicField),
  azureAdClientId: c.env("AZURE_AD_CLIENT_ID", publicField),
  azureAdTenantId: c.env("AZURE_AD_TENANT_ID", publicField),
  auth0ClientId: c.env("AUTH0_CLIENT_ID", publicField),
  auth0Issuer: c.env("AUTH0_ISSUER", publicField),
  oktaClientId: c.env("OKTA_CLIENT_ID", publicField),
  oktaIssuer: c.env("OKTA_ISSUER", publicField),
  cognitoClientId: c.env("COGNITO_CLIENT_ID", publicField),
  cognitoIssuer: c.env("COGNITO_ISSUER", publicField),
  oneLoginClientId: c.env("ONELOGIN_CLIENT_ID", publicField),
  oneLoginIssuer: c.env("ONELOGIN_ISSUER", publicField),
  oidcClientId: c.env("OIDC_CLIENT_ID", publicField),
  oidcIssuer: c.env("OIDC_ISSUER", publicField),
}));

export type SsoConfig = ConfigOf<typeof ssoConfig>;

/** Credentials. Never config fields — they resolve through the chain. */
export const ssoSecrets = {
  googleClientSecret: Secret.load("GOOGLE_CLIENT_SECRET", { optional: true }),
  githubClientSecret: Secret.load("GITHUB_CLIENT_SECRET", { optional: true }),
  gitlabClientSecret: Secret.load("GITLAB_CLIENT_SECRET", { optional: true }),
  azureAdClientSecret: Secret.load("AZURE_AD_CLIENT_SECRET", { optional: true }),
  auth0ClientSecret: Secret.load("AUTH0_CLIENT_SECRET", { optional: true }),
  oktaClientSecret: Secret.load("OKTA_CLIENT_SECRET", { optional: true }),
  cognitoClientSecret: Secret.load("COGNITO_CLIENT_SECRET", { optional: true }),
  oneLoginClientSecret: Secret.load("ONELOGIN_CLIENT_SECRET", { optional: true }),
  oidcClientSecret: Secret.load("OIDC_CLIENT_SECRET", { optional: true }),
} as const;

/**
 * What `SsoGateService` and the BetterAuth adapter consume: every provider's
 * public and credentialed halves in one object, assembled by `SsoApp.create`
 * from `ssoConfig`, `ssoSecrets`, and the process's public base URL.
 *
 * `isSaas` is a known gap, not a value this module can resolve on its own:
 * `IS_SAAS` is already declared by the `licensing` module's own config slice,
 * so a second declaration here would refuse the whole process by name at
 * boot (`ConfigClaimsSecretError`'s sibling, `ConfigCollisionError`). See the
 * lane handoff for `config-schema-nuke-sso`.
 */
export interface SsoConfiguration {
  isSaas: boolean;
  provider: string;
  baseUrl: string;
  googleClientId?: string;
  googleClientSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  gitlabClientId?: string;
  gitlabClientSecret?: string;
  azureAdClientId?: string;
  azureAdClientSecret?: string;
  azureAdTenantId?: string;
  auth0ClientId?: string;
  auth0ClientSecret?: string;
  auth0Issuer?: string;
  oktaClientId?: string;
  oktaClientSecret?: string;
  oktaIssuer?: string;
  cognitoClientId?: string;
  cognitoClientSecret?: string;
  cognitoIssuer?: string;
  oneLoginClientId?: string;
  oneLoginClientSecret?: string;
  oneLoginIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcIssuer?: string;
}
