// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  ScimWriteOutsideConnectionError,
  type ScimDirectoryOwnership,
} from "@langwatch/enterprise-scim-contract";

import type { ScimRepository } from "../repositories/scim.repository.ts";
import {
  standingClaimsAgainst,
  findSucceededConnections,
} from "../rules/scim-directory-ownership.rules.ts";
import type { ScimConnectionsService } from "./scim-connections.service.ts";

export type ScimHeldConnections = Pick<ScimConnectionsService, "findHeldConnections">;

/**
 * Who a connection's directory owns, with or without the identifier it sent.
 * An identifier resolves only within the connection that asserted it, and a
 * retired connection's claim lets its people go to a successor.
 */
export class ScimDirectoryIdentityService {
  private constructor(
    private readonly repository: ScimRepository,
    private readonly connections: ScimHeldConnections,
  ) {}

  static create({
    repository,
    connections,
  }: {
    repository: ScimRepository;
    connections: ScimHeldConnections;
  }): ScimDirectoryIdentityService {
    return new ScimDirectoryIdentityService(repository, connections);
  }

  findUserId(input: { connectionId: string; externalId: string }): Promise<string | null> {
    return this.repository.findDirectoryUserId(input);
  }

  /** A blank identifier is no identifier: ownership is kept and nothing is invented. */
  async remember(input: {
    organizationId: string;
    connectionId: string;
    externalId: string | null | undefined;
    userId: string;
  }): Promise<void> {
    const connections = await this.connections.findHeldConnections({
      organizationId: input.organizationId,
    });
    const externalId = input.externalId?.trim() ? input.externalId : null;
    await this.repository.rememberDirectoryIdentity({
      ...input,
      externalId,
      releasedConnectionIds: findSucceededConnections({
        connections,
        connectionId: input.connectionId,
      }),
    });
  }

  forget(input: { connectionId: string; externalId: string }): Promise<void> {
    return this.repository.forgetDirectoryIdentity(input);
  }

  forgetUser(input: {
    organizationId: string;
    connectionId: string | null;
    userId: string;
  }): Promise<void> {
    return this.repository.forgetDirectoryIdentitiesForUser(input);
  }

  /** Whom these connections' directories have claimed (ADR-122). */
  findOwnership(input: { connectionIds: string[] }): Promise<ScimDirectoryOwnership[]> {
    return this.repository.findDirectoryOwnership(input);
  }

  /**
   * Refuses a push at somebody another live connection of this organization
   * owns. Nobody's claim leaves a hand-invited member adoptable; a null
   * connection is a legacy token keeping the organization-wide reach it had.
   */
  async assertWritable(input: {
    organizationId: string;
    connectionId: string | null;
    userId: string;
  }): Promise<void> {
    if (input.connectionId === null) return;

    const claims = await this.repository.findDirectoryConnectionsForUser({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (claims.length === 0 || claims.includes(input.connectionId)) return;

    const connections = await this.connections.findHeldConnections({
      organizationId: input.organizationId,
    });
    const standing = standingClaimsAgainst({
      connections,
      connectionId: input.connectionId,
      claims,
    });
    if (standing.length > 0) {
      throw new ScimWriteOutsideConnectionError({ userId: input.userId });
    }
  }
}
