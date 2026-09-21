// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Who the directory means (D08).
 *
 * Two facts about one person, kept apart on purpose. This file owns the
 * first: the connection plus the directory's own identifier for them, a
 * PAIR. The address is not identity — people change theirs, and the same
 * person carries different identifiers on two different connections — so
 * every lookup and every write keys on both and `externalId` alone never
 * resolves anything.
 *
 * What falls out of that, and is the reason it exists:
 *
 *   - a person keeps their place when their email changes, because the
 *     mapping is what the push resolves through;
 *   - the same person on two connections is two directory identities and one
 *     LangWatch account, neither identifier overwriting the other;
 *   - the same identifier on two connections is two different people;
 *   - a push naming somebody a connection does not know provisions them
 *     under THAT connection only.
 *
 * The other fact — who made the write — is `system:scim`, stamped in
 * `scim.service.ts`, and deliberately says nothing about the connection.
 *
 * See specs/identity/scim-connection-sync.feature.
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

  /**
   * Record that this connection knows this person by this identifier.
   *
   * Upserted on the pair, so a re-push costs nothing and a person whose email
   * changed keeps the same mapping. Re-pointing an identifier at a different
   * account is allowed and is what the directory asking for it means: the
   * identifier is theirs to define.
   */
  async remember({
    connectionId,
    externalId,
    userId,
  }: {
    connectionId: string;
    externalId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.scimExternalId.upsert({
      where: { connectionId_externalId: { connectionId, externalId } },
      create: { connectionId, externalId, userId },
      update: { userId },
    });
  }

  /** Forget one directory identity — the person left this directory. */
  async forget({
    connectionId,
    externalId,
  }: {
    connectionId: string;
    externalId: string;
  }): Promise<void> {
    await this.prisma.scimExternalId.deleteMany({
      where: { connectionId, externalId },
    });
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
    const claims = await this.prisma.scimExternalId.findMany({
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
