// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Directory ownership survives absent or changed external identifiers.
 * Real external identifiers resolve only within their connection.
 */
import type { PrismaClient } from "~/generated/prisma/client";

import {
  ScimConnectionNotFoundError,
  ScimWriteOutsideConnectionError,
} from "./errors";

export class ScimDirectoryIdentityService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ScimDirectoryIdentityService {
    return new ScimDirectoryIdentityService(prisma);
  }

  /**
   * The LangWatch account this connection means by this identifier, or null
   * if it has never named them.
   */
  async getUserId({
    connectionId,
    externalId,
  }: {
    connectionId: string;
    externalId: string;
  }): Promise<string | null> {
    const row = await this.prisma.scimExternalId.findUnique({
      where: { connectionId_externalId: { connectionId, externalId } },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  /** Ownership is independent of the directory's optional external identifier. */
  async remember({
    organizationId,
    connectionId,
    externalId,
    userId,
  }: {
    connectionId: string;
    organizationId: string;
    externalId: string | null;
    userId: string;
  }): Promise<void> {
    const connection = await this.connectionForOrganization({
      organizationId,
      connectionId,
    });
    const predecessor =
      connection.migrationPhase === "FINALIZING" ||
      connection.migrationPhase === "FINALIZED"
        ? connection.replacesConnectionId
        : null;
    await this.prisma.$transaction([
      ...(predecessor
        ? [
            this.prisma.scimDirectoryUser.deleteMany({
              where: { organizationId, connectionId: predecessor, userId },
            }),
            this.prisma.scimExternalId.deleteMany({
              where: { organizationId, connectionId: predecessor, userId },
            }),
          ]
        : []),
      this.prisma.scimDirectoryUser.upsert({
        where: { connectionId_userId: { connectionId, userId } },
        create: { organizationId, connectionId, userId },
        update: {},
      }),
      ...(externalId
        ? [
            this.prisma.scimExternalId.upsert({
              where: { connectionId_externalId: { connectionId, externalId } },
              create: { organizationId, connectionId, externalId, userId },
              update: { userId },
            }),
          ]
        : []),
    ]);
  }

  /** DELETE forgets the person; deactivation keeps ownership for reactivation. */
  async forget({
    connectionId,
    userId,
  }: {
    connectionId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scimExternalId.deleteMany({
        where: { connectionId, userId },
      }),
      this.prisma.scimDirectoryUser.deleteMany({
        where: { connectionId, userId },
      }),
    ]);
  }

  async manages({
    connectionId,
    userId,
  }: {
    connectionId: string;
    userId: string;
  }): Promise<boolean> {
    const owner = await this.prisma.scimDirectoryUser.findUnique({
      where: { connectionId_userId: { connectionId, userId } },
    });
    return owner !== null;
  }

  /**
   * Refuse a push aimed at somebody another connection provisioned.
   *
   * This is the isolation story at the write boundary: a contractor directory
   * and a staff directory can share an organization precisely because neither
   * one's token reaches the other's people. A person NO connection has
   * claimed passes — that is a member an administrator invited by hand, or one
   * provisioned before connection scoping, and the directory may adopt them.
   *
   * `connectionId` null means a token minted before connection scoping whose
   * organization had no connection to be backfilled onto. It keeps the
   * organization-wide authority it was sold with, so there is nothing to
   * check.
   */
  async assertWritable({
    organizationId,
    connectionId,
    userId,
  }: {
    organizationId: string;
    connectionId: string | null;
    userId: string;
  }): Promise<void> {
    if (!connectionId) return;
    const connection = await this.connectionForOrganization({
      organizationId,
      connectionId,
    });
    const claims = await this.prisma.scimDirectoryUser.findMany({
      where: { organizationId, userId },
      select: { connectionId: true },
    });
    if (claims.length === 0) return;
    if (claims.some((claim) => claim.connectionId === connectionId)) return;

    const owners = await this.prisma.ssoConnection.findMany({
      where: {
        organizationId,
        id: { in: claims.map((claim) => claim.connectionId) },
        state: { notIn: ["DISCARDED", "TEARDOWN_PENDING", "TORN_DOWN"] },
      },
      select: { id: true },
    });
    const predecessor =
      connection.migrationPhase === "FINALIZING" ||
      connection.migrationPhase === "FINALIZED"
        ? connection.replacesConnectionId
        : null;
    if (owners.some((owner) => owner.id !== predecessor)) {
      throw new ScimWriteOutsideConnectionError({ userId });
    }
  }

  private async connectionForOrganization({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }) {
    const connection = await this.prisma.ssoConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { replacesConnectionId: true, migrationPhase: true },
    });
    if (!connection) throw new ScimConnectionNotFoundError(connectionId);
    return connection;
  }
}
