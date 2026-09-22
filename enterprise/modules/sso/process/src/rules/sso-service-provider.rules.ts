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
