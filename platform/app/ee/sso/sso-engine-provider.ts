// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SsoConnectionState } from "@langwatch/identity";
import { withoutTrailingSlashes } from "@langwatch/identity-server";
import type { SsoCredentialStore } from "./sso-credential-store";
import {
  discoveryEndpointFor,
  parseSamlIdpConfig,
} from "./sso-idp-registration";
import type { SsoProviderConfigCipher } from "./sso-provider-config";
import type { SsoServiceProviderDetails } from "./sso-self-serve.types";

/**
 * The engine's provider row, DERIVED from a connection's folded state (D09 —
 * see specs/identity/sso-idp-termination.feature).
 *
 * better-auth's single sign-on plugin owns the columns and every read of
 * them; what it does not own is whether a row should exist. That is folded
 * from the connection log by the same projection that writes the connection
 * head, which is what makes the engine's table a projection rather than a
 * second source of truth: replay the ledger and both rows come back, in the
 * same shape, with nothing to reconcile.
 *
 * The function below is the whole derivation. It is pure given the vault, and
 * the vault is keyed by references the log carries — so the only thing a
 * replay needs that the log does not hold is the credential material, which
 * is the one thing that may never be in it.
 */

interface EngineProviderBase {
  /** The plugin's own primary key. The connection id, so a fold is an upsert
   *  and never a duplicate. */
  id: string;
  /** What a sign-in names to reach this provider. The CONNECTION ID rather
   *  than the name the customer typed: the plugin's column is globally
   *  unique, and two organizations both calling their provider `okta` must
   *  both be able to. */
  providerId: string;
  organizationId: string;
  issuer: string;
  /** Every domain this connection has actually proved, comma-joined, which is
   *  the plugin's own multi-domain spelling. Empty until one is proved — our
   *  router does the domain matching, so this is what the engine falls back
   *  on and never the thing that decides. */
  domain: string;
}

export interface SsoEngineProviderRow extends EngineProviderBase {
  oidcConfig: string | null;
  samlConfig: string | null;
}

/**
 * The states in which a connection may be dialed.
 *
 * SUSPENDED is not among them, and that is the point of suspending one: the
 * row is removed, so the provider stops existing as far as the engine is
 * concerned and a saved sign-in link stops working — rather than continuing
 * to authenticate people while a screen elsewhere says it is paused.
 * DISCARDED and TORN_DOWN are terminal and go the same way.
 */
/**
 * The states a sign-in may reach the identity provider through.
 *
 * Wider than "live" on purpose, and the reason is the journey rather than a
 * convenience: activation refuses without a sign-in that actually happened
 * through the connection, so a connection under setup HAS to be dialable or
 * it could never be activated. What stops that from being a way in for
 * anybody is not this set — it is `ssoAssertionDecision`, which lets a
 * connection that is not yet ACTIVE assert ONE address: the one belonging to
 * the administrator who registered it. Any member of the organization was
 * too wide, and reading it that way was an account takeover of a colleague:
 * proving the round trip works takes one person, and that person is the one
 * doing the setup.
 *
 * `REJECTED` is not here. An operator turning a domain claim down is a
 * decision, and a connection that could still carry sign-ins afterwards would
 * make it a decision about nothing.
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

/**
 * The row this connection projects to, or null when it projects to none.
 *
 * Null has two causes and they are the same answer: the connection is in a
 * state nothing may dial, or it holds no credential references and so was
 * registered before D09 (or grandfathered from the legacy string columns,
 * which name a provider the deployment mounts and nothing this engine can
 * reach). Neither is an error — the fold writes no row and the router reads
 * "not configured", which is exactly true.
 */
export async function engineProviderFor({
  connection,
  credentials,
  baseUrl,
  providerConfig,
}: {
  connection: SsoConnectionState;
  credentials: SsoCredentialStore;
  /** The deployment's own address. Needed because a SAML service provider
   *  has to say what it is called, and what LangWatch is called to an
   *  identity provider is where LangWatch lives. */
  baseUrl: string;
  /**
   * Seals the dialing document this derivation produces (D09).
   *
   * The document carries the client secret this function has just read OUT
   * of the vault, so emitting it in the clear would put every customer's
   * live credential in a second table with nothing over it. Sealing HERE
   * rather than at the projection keeps the one place that assembles the
   * document and the one place that protects it together.
   */
  providerConfig: SsoProviderConfigCipher;
}): Promise<SsoEngineProviderRow | null> {
  if (!connectionIsDialable(connection.state)) return null;

  const base = {
    id: connection.connectionId,
    providerId: connection.connectionId,
    organizationId: connection.organizationId,
    issuer: connection.idpMetadata.issuer ?? connection.connectionId,
    domain: connection.verifiedDomains.join(","),
  };

  return connection.type === "oidc"
    ? oidcProviderFor({ connection, base, credentials, providerConfig })
    : samlProviderFor({
        connection,
        base,
        credentials,
        baseUrl,
        providerConfig,
      });
}

async function oidcProviderFor({
  connection,
  base,
  credentials,
  providerConfig,
}: {
  connection: SsoConnectionState;
  base: EngineProviderBase;
  credentials: SsoCredentialStore;
  providerConfig: SsoProviderConfigCipher;
}): Promise<SsoEngineProviderRow | null> {
  const { clientIdRef, secretRef, issuer } = connection.idpMetadata;
  if (clientIdRef === null || secretRef === null || issuer === null) {
    return null;
  }
  const [clientId, clientSecret] = await Promise.all([
    credentials.read({
      organizationId: connection.organizationId,
      ref: clientIdRef,
    }),
    credentials.read({
      organizationId: connection.organizationId,
      ref: secretRef,
    }),
  ]);
  if (clientId === null || clientSecret === null) return null;
  return {
    ...base,
    issuer,
    oidcConfig: providerConfig.seal(
      JSON.stringify({
        clientId,
        clientSecret,
        discoveryEndpoint: discoveryEndpointFor({ issuer }),
        pkce: true,
        scopes: ["openid", "email", "profile"],
        mapping: {
          id: "sub",
          email: "email",
          emailVerified: "email_verified",
        },
      }),
    ),
    samlConfig: null,
  };
}

async function samlProviderFor({
  connection,
  base,
  credentials,
  baseUrl,
  providerConfig,
}: {
  connection: SsoConnectionState;
  base: EngineProviderBase;
  credentials: SsoCredentialStore;
  baseUrl: string;
  providerConfig: SsoProviderConfigCipher;
}): Promise<SsoEngineProviderRow | null> {
  const [certRef] = connection.idpMetadata.certRefs;
  if (certRef === undefined) return null;
  const stored = await credentials.read({
    organizationId: connection.organizationId,
    ref: certRef,
  });
  if (stored === null) return null;
  const config = parseSamlIdpConfig(stored);
  if (config === null) return null;

  return {
    ...base,
    issuer: config.entityId ?? connection.idpMetadata.issuer ?? base.issuer,
    oidcConfig: null,
    samlConfig: providerConfig.seal(
      JSON.stringify({
        entryPoint: config.entryPoint,
        ...(config.certificate === null ? {} : { cert: config.certificate }),
        idpMetadata: config.metadataXml
          ? {
              metadata: config.metadataXml,
              ...(config.entityId === null
                ? {}
                : { entityID: config.entityId }),
            }
          : { entityID: config.entityId },
        spMetadata: {
          entityID: serviceProviderDetailsFor({
            baseUrl,
            connectionId: connection.connectionId,
          }).entityId,
        },
        wantAssertionsSigned: true,
        mapping: { id: "nameID", email: "email" },
      }),
    ),
  };
}

/**
 * LangWatch's own side of the connection: what an administrator has to type
 * into THEIR identity provider before any of ours will work.
 *
 * Derived from the deployment's address and the plugin's mount points rather
 * than configured, because a value somebody has to keep in step with the
 * routes is a value that will eventually be wrong on exactly the screen
 * nobody can debug from.
 */
export function serviceProviderDetailsFor({
  baseUrl,
  connectionId,
}: {
  baseUrl: string;
  connectionId: string | null;
}): SsoServiceProviderDetails {
  const auth = `${withoutTrailingSlashes(baseUrl)}/api/auth`;
  // Before a connection exists there is nothing to key the per-provider paths
  // on, so the placeholder says what will replace it. An administrator
  // reading the screen before they register is being shown the SHAPE, and a
  // fabricated id would be worse than an obvious gap.
  const provider = connectionId ?? "{connection}";
  return {
    redirectUrl: `${auth}/sso/callback/${provider}`,
    assertionConsumerServiceUrl: `${auth}/sso/saml2/sp/acs/${provider}`,
    singleLogoutUrl: `${auth}/sso/saml2/sp/slo/${provider}`,
    // One entity id for the whole deployment rather than one per connection.
    // LangWatch is one service provider that talks to many identity
    // providers, which is what the name is for, and a per-connection name
    // would mean an organization with two connections told to trust two
    // different LangWatches.
    entityId: `${auth}/sso/saml2/sp`,
    metadataUrl: `${auth}/sso/saml2/sp/metadata?providerId=${provider}`,
  };
}
