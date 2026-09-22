import {
  SsoConnectionNotFoundError,
  type OrganizationSsoConnection,
  type SsoConnectionProviderReading,
  type SsoConnectionState,
} from "@langwatch/identity-contract";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";

/**
 * An organization's SSO connections, as a peer module is answered. Identity
 * owns these rows, so a peer that needs one asks for it here rather than
 * querying the table itself.
 */
export class OrganizationSsoConnectionsService {
  static create(deps: {
    connections: SsoConnectionReadRepository;
  }): OrganizationSsoConnectionsService {
    return new OrganizationSsoConnectionsService(deps.connections);
  }

  private constructor(private readonly connections: SsoConnectionReadRepository) {}

  /** Newest first. Empty when the organization has registered none. */
  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationSsoConnection[]> {
    const states = await this.connections.findForOrganization({ organizationId });
    return states.map(toOrganizationConnection);
  }

  /** Refused for a connection that is not this organization's: a peer sweeping
   *  rows must never be handed a provider it did not ask about. */
  async getProvider({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoConnectionProviderReading> {
    const connection = await this.connections.tryFindConnection({ connectionId });
    if (!connection || connection.organizationId !== organizationId) {
      throw new SsoConnectionNotFoundError(
        `Connection ${connectionId} is not one of organization ${organizationId}'s.`,
      );
    }

    return { connectionId, providerId: connection.idpMetadata.providerId };
  }
}

function toOrganizationConnection(state: SsoConnectionState): OrganizationSsoConnection {
  return {
    connectionId: state.connectionId,
    // The provider id IS the word an administrator reads today: registration
    // collected it under that name and nothing routes on it.
    displayName: state.idpMetadata.providerId,
    providerId: state.idpMetadata.providerId,
    verifiedDomains: state.verifiedDomains,
    type: state.type,
    state: state.state,
  };
}
