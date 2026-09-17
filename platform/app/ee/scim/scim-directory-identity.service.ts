// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Directory ownership survives absent or changed external identifiers.
 * Real external identifiers resolve only within their connection.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { ScimWriteOutsideConnectionError } from "./errors";

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
    connectionId,
    externalId,
    userId,
  }: {
    connectionId: string;
    externalId: string | null;
    userId: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scimDirectoryUser.upsert({
        where: { connectionId_userId: { connectionId, userId } },
        create: { connectionId, userId },
        update: {},
      }),
      ...(externalId
        ? [
            this.prisma.scimExternalId.upsert({
              where: { connectionId_externalId: { connectionId, externalId } },
              create: { connectionId, externalId, userId },
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
    connectionId,
    userId,
  }: {
    connectionId: string | null;
    userId: string;
  }): Promise<void> {
    if (!connectionId) return;
    const claims = await this.prisma.scimDirectoryUser.findMany({
      where: { userId },
      select: { connectionId: true },
    });
    if (claims.length === 0) return;
    if (claims.some((claim) => claim.connectionId === connectionId)) return;
    // Names only the person the caller already sent. Which OTHER connection
    // holds them is not the pushing directory's business.
    throw new ScimWriteOutsideConnectionError({ userId });
  }
}
