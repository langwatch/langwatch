/**
 * The engine's provider row, derived from a connection's folded state (D09).
 * The engine owns those columns; what it does not own is whether a row should
 * exist — that is folded from the connection log, so replay rebuilds both.
 */
import type { SsoSamlIdpConfig } from "@langwatch/identity-contract";

/** What a fold writes, or removes when the connection projects to none. */
export interface SsoEngineProviderRow {
  /** The engine's own primary key. The connection id, so a fold is an upsert
   *  and never a duplicate. */
  id: string;
  /** What a sign-in names to reach this provider. The CONNECTION ID rather
   *  than the name the customer typed: the column is globally unique, and two
   *  organizations both calling their provider `okta` must both be able to. */
  providerId: string;
  organizationId: string;
  issuer: string;
  /** Every domain this connection has actually proved, comma-joined, which is
   *  the engine's own multi-domain spelling. Empty until one is proved — our
   *  router does the domain matching, so this is the fallback and never the
   *  thing that decides. */
  domain: string;
  oidcConfig: string | null;
  samlConfig: string | null;
}

/**
 * The states a sign-in may reach the identity provider through. Wider than
 * "live" because activation refuses without a sign-in through the connection;
 * SUSPENDED is absent, so suspending one stops a saved sign-in link working.
 */
const DIALABLE_STATES = new Set([
  "DRAFT",
  "CLAIMED",
  "APPROVED",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "ACTIVE",
]);

export function connectionIsDialable(state: string): boolean {
  return DIALABLE_STATES.has(state);
}

function withoutTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * What LangWatch calls itself to every identity provider. One entity id for
 * the whole deployment rather than one per connection: an organization with
 * two connections would otherwise be told to trust two different LangWatches.
 */
export function ssoServiceProviderEntityId({ baseUrl }: { baseUrl: string }): string {
  return `${withoutTrailingSlashes(baseUrl)}/api/auth/sso/saml2/sp`;
}

/** The OIDC dialing document, from credential values already read. */
export function oidcProviderDocument({
  clientId,
  clientSecret,
  discoveryEndpoint,
}: {
  clientId: string;
  clientSecret: string;
  discoveryEndpoint: string;
}): string {
  return JSON.stringify({
    clientId,
    clientSecret,
    discoveryEndpoint,
    pkce: true,
    scopes: ["openid", "email", "profile"],
    mapping: { id: "sub", email: "email", emailVerified: "email_verified" },
  });
}

/** The SAML dialing document, from the stored identity-provider config. */
export function samlProviderDocument({
  config,
  serviceProviderEntityId,
}: {
  config: SsoSamlIdpConfig;
  serviceProviderEntityId: string;
}): string {
  return JSON.stringify({
    entryPoint: config.entryPoint,
    ...(config.certificate === null ? {} : { cert: config.certificate }),
    idpMetadata: config.metadataXml
      ? {
          metadata: config.metadataXml,
          ...(config.entityId === null ? {} : { entityID: config.entityId }),
        }
      : { entityID: config.entityId },
    spMetadata: { entityID: serviceProviderEntityId },
    wantAssertionsSigned: true,
    mapping: { id: "nameID", email: "email" },
  });
}
