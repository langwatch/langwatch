import type { ScimApi } from "@langwatch/enterprise-scim-contract";

import type { OrganizationSsoConnectionsService } from "./organization-sso-connections.service.ts";

/**
 * A finished move to an organization's own identity provider asks directory sync to follow it:
 * the replaced connection is identity's to name, the move itself scim's (ARCHITECTURE.md §9).
 */
export class SsoConnectionDirectoryMoveService {
  static create(deps: {
    connections: Pick<OrganizationSsoConnectionsService, "findForOrganization">;
    scim: Pick<ScimApi, "moveToConnection">;
  }): SsoConnectionDirectoryMoveService {
    return new SsoConnectionDirectoryMoveService(deps);
  }

  private constructor(
    private readonly deps: {
      connections: Pick<OrganizationSsoConnectionsService, "findForOrganization">;
      scim: Pick<ScimApi, "moveToConnection">;
    },
  ) {}

  /** Nothing to move for a connection that replaced none. */
  async migrationFinalized(input: { organizationId: string; connectionId: string }): Promise<void> {
    const held = await this.deps.connections.findForOrganization({
      organizationId: input.organizationId,
    });
    const fromConnectionId = held.find(
      (connection) => connection.connectionId === input.connectionId,
    )?.replacesConnectionId;
    if (!fromConnectionId) return;
    await this.deps.scim.moveToConnection({
      organizationId: input.organizationId,
      fromConnectionId,
      toConnectionId: input.connectionId,
    });
  }
}
