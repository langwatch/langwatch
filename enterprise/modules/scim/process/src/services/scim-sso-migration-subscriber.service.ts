// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  ScimSsoMigrationSubscriberService as ScimSsoMigrationSubscriberCapability,
  type ScimSsoMigrationFinalizedEvent,
  type ScimSsoMigrationSubscriberContext,
} from "@langwatch/enterprise-scim-contract";

import type { ScimSyncLifecycle } from "../app/scim.members.ts";
import type { ScimRepository } from "../repositories/scim.repository.ts";
import type { ScimConnectionsService } from "./scim-connections.service.ts";

type ScimSsoMigrationSubscriberDeps = {
  connections: Pick<ScimConnectionsService, "findHeldConnections">;
  directory: Pick<ScimRepository, "findTokenIdsForConnection" | "moveDirectoryToConnection">;
  lifecycle: Pick<ScimSyncLifecycle, "tokenIssued" | "revoked">;
};

/**
 * A directory sync LangWatch set up moves with the sign-in it came with: when
 * the move finishes, the previous connection's tokens and identities follow.
 * Safe to redeliver: each step answers the same once it has happened.
 */
export class ScimSsoMigrationSubscriberService extends ScimSsoMigrationSubscriberCapability {
  static create(deps: ScimSsoMigrationSubscriberDeps): ScimSsoMigrationSubscriberService {
    return new ScimSsoMigrationSubscriberService(deps);
  }

  private constructor(private readonly deps: ScimSsoMigrationSubscriberDeps) {
    super();
  }

  async handleMigrationFinalized(
    event: ScimSsoMigrationFinalizedEvent,
    context: ScimSsoMigrationSubscriberContext,
  ): Promise<void> {
    const organizationId = context.tenantId;
    const toConnectionId = event.data.connectionId;
    const held = await this.deps.connections.findHeldConnections({ organizationId });
    const fromConnectionId = held.find(
      (connection) => connection.connectionId === toConnectionId,
    )?.replacesConnectionId;
    if (!fromConnectionId) return;

    const tokenIds = await this.deps.directory.findTokenIdsForConnection({
      organizationId,
      connectionId: fromConnectionId,
    });
    for (const tokenId of tokenIds) {
      await this.deps.lifecycle.tokenIssued({
        organizationId,
        connectionId: toConnectionId,
        tokenId,
      });
    }
    await this.deps.directory.moveDirectoryToConnection({
      organizationId,
      fromConnectionId,
      toConnectionId,
      tokenIds,
    });
    await this.deps.lifecycle.revoked({
      organizationId,
      connectionId: fromConnectionId,
      tokenId: null,
      cause: "teardown",
    });
  }
}
