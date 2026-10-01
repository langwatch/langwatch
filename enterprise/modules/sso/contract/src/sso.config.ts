// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Deployment facts (ADR-132): which provider `AUTH_PROVIDER` names (the
 * deprecated `NEXTAUTH_PROVIDER` still read beside it), and
 * the public half of each identity provider's OAuth registration — a client
 * id and an issuer are not credentials. Every `*ClientSecret` resolves through
 * `@langwatch/secrets` (`signInProviderSecrets`); the platform license key is licensing's, asked through its API.
 */
import { Config, signInProviders, type ConfigOf } from "@langwatch/config";

/** The shared leaves (`@langwatch/config`): auth reads the same ones to build the providers. */
export const ssoConfig = Config.define(() => ({ ...signInProviders }));

export type SsoConfig = ConfigOf<typeof ssoConfig>;

/**
 * What `SsoGateService` and the BetterAuth adapter consume: every provider's
 * public and credentialed halves in one object, assembled by `SsoApp.create`
 * from `ssoConfig`, `signInProviderSecrets`, and the process's public base URL.
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
