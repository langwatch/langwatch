// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What LangWatch is, to somebody configuring their identity provider: the
 * addresses this deployment answers on. This module serves them, so it — not
 * identity — is what answers them (D09).
 */

function withoutTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export interface SsoServiceProviderAddresses {
  redirectUrl: string;
  assertionConsumerServiceUrl: string;
  singleLogoutUrl: string;
  entityId: string;
  metadataUrl: string;
}

export function ssoServiceProviderAddresses({
  baseUrl,
  connectionId,
}: {
  baseUrl: string;
  connectionId: string | null;
}): SsoServiceProviderAddresses {
  const auth = `${withoutTrailingSlashes(baseUrl)}/api/auth`;
  // Before a connection exists there is nothing to key the per-provider paths
  // on, so the placeholder says what will replace it: an administrator
  // reading the page before they register is being shown the SHAPE, and a
  // fabricated id would be worse than an obvious gap.
  const provider = connectionId ?? "{connection}";

  return {
    redirectUrl: `${auth}/sso/callback/${provider}`,
    assertionConsumerServiceUrl: `${auth}/sso/saml2/sp/acs/${provider}`,
    singleLogoutUrl: `${auth}/sso/saml2/sp/slo/${provider}`,
    // One entity id for the whole deployment rather than one per connection.
    // LangWatch is one service provider talking to many identity providers,
    // which is what the name is for; a per-connection name would tell an
    // organization with two connections to trust two different LangWatches.
    entityId: `${auth}/sso/saml2/sp`,
    metadataUrl: `${auth}/sso/saml2/sp/metadata?providerId=${provider}`,
  };
}

/**
 * The provider ids a deployment names for its own sign-in, in the words the
 * sign-in picker uses for them. Auth0 is a bridge there, offering the
 * connections behind it; any id not listed is "single sign-on".
 */
const DEPLOYMENT_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  "azure-ad": "Microsoft",
  microsoft: "Microsoft",
  auth0: "Auth0",
  cognito: "Amazon Cognito",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  okta: "Okta",
  onelogin: "OneLogin",
};
const SINGLE_SIGN_ON = "single sign-on";

export interface DeploymentSignIn {
  name: string;
  redirectUrl: string;
}

/**
 * The sign-in the deployment configures for itself, beside the connection set
 * up here: a separate door returning to `/api/auth/callback/<provider>`. Empty
 * when the deployment signs in with email only (also what a denied licence reads as).
 */
export function findDeploymentSignIns({
  provider,
  baseUrl,
}: {
  provider: string;
  baseUrl: string;
}): DeploymentSignIn[] {
  if (provider === "" || provider === "email") return [];
  return [
    {
      name: DEPLOYMENT_PROVIDER_NAMES[provider] ?? SINGLE_SIGN_ON,
      redirectUrl: `${withoutTrailingSlashes(baseUrl)}/api/auth/callback/${provider}`,
    },
  ];
}
