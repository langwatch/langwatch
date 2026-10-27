// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimDirectoryConnection } from "@langwatch/enterprise-scim-contract";
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";

import type { ScimSsoConnectionReadRepository } from "../repositories/scim-sso-connection.repository.ts";
import { toOrganizationSsoConnection } from "../rules/scim-sso-connection.rules.ts";

/** SCIM's own fold of identity's connection facts: the one place it learns which connections exist. */
export type ScimConnectionReads = Pick<ScimSsoConnectionReadRepository, "findForOrganization">;

/** The directory connections a token can be minted against. */
export class ScimConnectionsService {
  private constructor(private readonly connections: ScimConnectionReads) {}

  static create(connections: ScimConnectionReads): ScimConnectionsService {
    return new ScimConnectionsService(connections);
  }

  async findConnections(input: { organizationId: string }): Promise<ScimDirectoryConnection[]> {
    const connections = await this.findHeldConnections(input);

    return connections.map((connection) => ({
      connectionId: connection.connectionId,
      displayName: connection.displayName,
      type: connection.type,
      state: connection.state,
    }));
  }

  /** Every connection the organization holds, newest first, as SCIM folded identity's facts. */
  async findHeldConnections(input: {
    organizationId: string;
  }): Promise<OrganizationSsoConnection[]> {
    const folded = await this.connections.findForOrganization({
      organizationId: input.organizationId,
    });
    return folded.map(toOrganizationSsoConnection);
  }
}
