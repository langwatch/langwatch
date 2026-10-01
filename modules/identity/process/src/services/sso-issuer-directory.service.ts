import { HandledError } from "@langwatch/handled-error";
import { normalizeDomain, type SsoIssuerDirectoryApi } from "@langwatch/identity-contract";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";

/**
 * Which issuers this installation's own connections registered — what the
 * sign-in door's trusted set is built from. No list shipped with a deploy
 * contains the next customer's provider; registration is the declaration.
 */
export class SsoIssuerDirectoryService implements SsoIssuerDirectoryApi {
  static create(deps: { connections: SsoConnectionReadRepository }): SsoIssuerDirectoryService {
    return new SsoIssuerDirectoryService(deps.connections);
  }

  private constructor(private readonly connections: SsoConnectionReadRepository) {}

  /** Not restricted by lifecycle: an administrator testing a connection they
   *  have not activated yet is dialing it, and refusing that is the whole
   *  reason a setup journey stalls. */
  async findIssuersForConnection({ connectionId }: { connectionId: string }): Promise<string[]> {
    const connection = await this.connections
      .getConnection({ connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    const issuer = connection?.idpMetadata.issuer;
    return issuer ? [issuer] : [];
  }

  /**
   * An address typed into the sign-in box names a domain, never a connection,
   * so only a PROVED domain on an active connection answers here — which is
   * exactly what the ownership read already means.
   */
  async findIssuersForDomain({ domain }: { domain: string }): Promise<string[]> {
    const owner = await this.connections
      .getDomainOwner({ domain: normalizeDomain(domain) })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    if (!owner) return [];
    return this.findIssuersForConnection({ connectionId: owner.connectionId });
  }
}
