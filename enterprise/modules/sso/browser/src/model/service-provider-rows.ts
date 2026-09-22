// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What LangWatch is, to somebody about to configure their identity provider
 * (D09). Only the chosen protocol's values: OpenID Connect needs one address
 * and SAML three, and all four at once read as a wall of URLs where every
 * reader had to work out which lines were theirs.
 */
import type { SsoConnectionType } from "@langwatch/identity-contract";

/** The four addresses a deployment answers with. The server owns them. */
export interface ServiceProviderAddresses {
  redirectUrl: string;
  assertionConsumerServiceUrl: string;
  entityId: string;
  metadataUrl: string;
}

/** One value to paste elsewhere, with what it is for in the reader's words. */
export interface ServiceProviderRow {
  label: string;
  hint: string;
  value: string;
}

export function serviceProviderRowsFor({
  protocol,
  addresses,
}: {
  protocol: SsoConnectionType;
  addresses: ServiceProviderAddresses;
}): ServiceProviderRow[] {
  if (protocol === "oidc") {
    return [
      {
        label: "Redirect address",
        hint: "Where your identity provider sends people back to",
        value: addresses.redirectUrl,
      },
    ];
  }

  return [
    {
      label: "Assertion address",
      hint: "Where your identity provider posts the signed assertion",
      value: addresses.assertionConsumerServiceUrl,
    },
    {
      label: "Entity id",
      hint: "What to call LangWatch in your identity provider",
      value: addresses.entityId,
    },
    {
      label: "Service provider metadata",
      hint: "Import this address if your identity provider takes one",
      value: addresses.metadataUrl,
    },
  ];
}

/**
 * Whether the addresses are still carrying the placeholder the connection's
 * own id fills. Said out loud, because an administrator who pastes one of
 * these before registering has configured their provider to nothing.
 */
export const SERVICE_PROVIDER_PLACEHOLDER = "{connection}";
