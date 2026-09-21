// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimDirectoryConnection } from "@langwatch/enterprise-scim-contract";
import type { IdentityApi } from "@langwatch/identity-contract";

/**
 * The one thing SCIM asks Identity about connections: which ones this
 * organization holds. Identity owns those rows, so this is a peer's answer
 * rather than a query of its tables.
 */
export type ScimConnectionReads = Pick<IdentityApi, "ssoConnectionReads">;

/** The directory connections a token can be minted against. */
export class ScimConnectionsService {
  private constructor(private readonly identity: ScimConnectionReads) {}

  static create(identity: ScimConnectionReads): ScimConnectionsService {
    return new ScimConnectionsService(identity);
  }

  async findConnections(input: { organizationId: string }): Promise<ScimDirectoryConnection[]> {
    const connections = await this.identity
      .ssoConnectionReads()
      .findForOrganization({ organizationId: input.organizationId });

    return connections.map((connection) => ({
      connectionId: connection.connectionId,
      displayName: connection.displayName,
      type: connection.type,
      state: connection.state,
    }));
  }
}
