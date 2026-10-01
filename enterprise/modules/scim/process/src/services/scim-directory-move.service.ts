// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimSyncLifecycle } from "../app/scim.members.ts";
import type { ScimRepository } from "../repositories/scim.repository.ts";

type ScimDirectoryMoveDeps = {
  directory: Pick<ScimRepository, "findTokenIdsForConnection" | "moveDirectoryToConnection">;
  lifecycle: Pick<ScimSyncLifecycle, "tokenIssued" | "revoked">;
};

/**
 * A directory sync LangWatch set up moves with the sign-in it came with: the previous
 * connection's tokens and identities follow the replacement. Safe to run again: each step
 * answers the same once it has happened.
 */
export class ScimDirectoryMoveService {
  static create(deps: ScimDirectoryMoveDeps): ScimDirectoryMoveService {
    return new ScimDirectoryMoveService(deps);
  }

  private constructor(private readonly deps: ScimDirectoryMoveDeps) {}

  async moveToConnection({
    organizationId,
    fromConnectionId,
    toConnectionId,
  }: {
    organizationId: string;
    fromConnectionId: string;
    toConnectionId: string;
  }): Promise<{ moved: number }> {
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
    return { moved: tokenIds.length };
  }
}
