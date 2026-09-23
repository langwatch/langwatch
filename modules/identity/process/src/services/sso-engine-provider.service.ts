/**
 * The engine's provider row, derived from a connection's folded state and kept
 * in step with it (D09). Pure given the vault, which the log's references key:
 * only the credential material is absent from the log, and may never be in it.
 */
import {
  parseSamlIdpConfig,
  type SsoConnectionState,
  type SsoProviderConfigCipher,
} from "@langwatch/identity-contract";

import type { SsoCredentialRepository } from "../repositories/sso-credential.repository.ts";
import type {
  SsoEngineProviderProjection,
  SsoEngineProviderRepository,
} from "../repositories/sso-engine-provider.repository.ts";
import {
  connectionIsDialable,
  oidcProviderDocument,
  samlProviderDocument,
  ssoServiceProviderEntityId,
  type SsoEngineProviderRow,
} from "../rules/sso-engine-provider.rules.ts";
import { discoveryEndpointFor } from "../rules/sso-idp-registration.rules.ts";

export type SsoEngineProviderDeps = {
  credentials: SsoCredentialRepository;
  rows: SsoEngineProviderRepository;
  /** The deployment's own address: a SAML service provider has to say what it
   *  is called, and what LangWatch is called is where LangWatch lives. */
  baseUrl: string;
  /** Seals the dialing document. It carries the client secret just read OUT
   *  of the vault, so emitting it in the clear would put every customer's
   *  live credential in a second table with nothing over it. */
  providerConfig: SsoProviderConfigCipher;
};

export class SsoEngineProviderService implements SsoEngineProviderProjection {
  static create(deps: SsoEngineProviderDeps): SsoEngineProviderService {
    return new SsoEngineProviderService(deps);
  }

  private constructor(private readonly deps: SsoEngineProviderDeps) {}

  async project({ connection }: { connection: SsoConnectionState }): Promise<void> {
    const row = await this.derive({ connection });
    if (row === null) {
      await this.deps.rows.remove({ connectionId: connection.connectionId });
      return;
    }
    await this.deps.rows.put(row);
  }

  /**
   * The row this connection projects to, or none: it is in a state nothing may
   * dial, or it names a provider this engine cannot reach. Neither is an
   * error — the door reads "not configured", which is exactly true.
   */
  async derive({
    connection,
  }: {
    connection: SsoConnectionState;
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
      ? this.oidcRow({ connection, base })
      : this.samlRow({ connection, base });
  }

  private async oidcRow({
    connection,
    base,
  }: {
    connection: SsoConnectionState;
    base: Omit<SsoEngineProviderRow, "oidcConfig" | "samlConfig">;
  }): Promise<SsoEngineProviderRow | null> {
    const { clientIdRef, secretRef, issuer } = connection.idpMetadata;
    if (clientIdRef === null || secretRef === null || issuer === null) return null;

    const [clientId, clientSecret] = await Promise.all([
      this.deps.credentials.read({ organizationId: connection.organizationId, ref: clientIdRef }),
      this.deps.credentials.read({ organizationId: connection.organizationId, ref: secretRef }),
    ]);
    if (!clientId.found || !clientSecret.found) return null;

    return {
      ...base,
      issuer,
      oidcConfig: this.deps.providerConfig.seal(
        oidcProviderDocument({
          clientId: clientId.value,
          clientSecret: clientSecret.value,
          discoveryEndpoint: discoveryEndpointFor({ issuer }),
        }),
      ),
      samlConfig: null,
    };
  }

  private async samlRow({
    connection,
    base,
  }: {
    connection: SsoConnectionState;
    base: Omit<SsoEngineProviderRow, "oidcConfig" | "samlConfig">;
  }): Promise<SsoEngineProviderRow | null> {
    const [certRef] = connection.idpMetadata.certRefs;
    if (certRef === undefined) return null;

    const stored = await this.deps.credentials.read({
      organizationId: connection.organizationId,
      ref: certRef,
    });
    if (!stored.found) return null;
    const config = parseSamlIdpConfig(stored.value);
    if (config === null) return null;

    return {
      ...base,
      issuer: config.entityId ?? connection.idpMetadata.issuer ?? base.issuer,
      oidcConfig: null,
      samlConfig: this.deps.providerConfig.seal(
        samlProviderDocument({
          config,
          serviceProviderEntityId: ssoServiceProviderEntityId({ baseUrl: this.deps.baseUrl }),
        }),
      ),
    };
  }
}
