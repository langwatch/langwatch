// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimRepository } from "../repositories/scim.repository.ts";
import type { ScimConnectionsService } from "./scim-connections.service.ts";

type ScimDirectoryExternalIdsReads = {
  connections: Pick<ScimConnectionsService, "findHeldConnections">;
  identities: Pick<ScimRepository, "findDirectoryExternalIds">;
};

/** An external id means something only on the connection that issued it, so the read starts from the connections. */
export class ScimDirectoryExternalIdsService {
  private constructor(private readonly reads: ScimDirectoryExternalIdsReads) {}

  static create(reads: ScimDirectoryExternalIdsReads): ScimDirectoryExternalIdsService {
    return new ScimDirectoryExternalIdsService(reads);
  }

  async findForOrganization(input: {
    organizationId: string;
  }): Promise<{ userId: string; externalId: string }[]> {
    const connections = await this.reads.connections.findHeldConnections(input);
    if (connections.length === 0) return [];

    return this.reads.identities.findDirectoryExternalIds({
      connectionIds: connections.map((connection) => connection.connectionId),
    });
  }
}
