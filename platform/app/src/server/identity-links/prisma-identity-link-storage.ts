import {
  EMAIL_EXTERNAL_KINDS,
  isEmailKind,
  type AppendLinkInput,
  type EraseIdentifiersInput,
  type EraseIdentifiersResult,
  type IdentityLinkRow,
  type IdentityLinkStorage,
  type LinkSource,
  type LoginRef,
} from "@langwatch/identity-links";

import type { PrismaClient } from "~/generated/prisma/client";

type DbLinkRow = {
  id: string;
  seq: bigint;
  organizationId: string;
  provider: string;
  providerConnectionId: string;
  externalKind: string;
  externalId: string;
  userId: string | null;
  effectiveFrom: Date;
  recordedAt: Date;
  source: string;
  actorUserId: string | null;
  erasedAt: Date | null;
};

const toRow = (row: DbLinkRow): IdentityLinkRow => ({
  ...row,
  source: row.source as LinkSource,
});

/**
 * The Prisma implementation of the add-only link storage (ADR-094 Decisions
 * 3, 6, 11). Mutators are exactly `appendLink` and `eraseIdentifiers` — a
 * test pins that surface. Every query names `organizationId`
 * (ORG_SCOPED_MODELS enforces it); `providerConnectionId` is a plain id with
 * no relation, so ownership is validated here, before any insert.
 *
 * Erasure here covers link rows only. The erasure feature's other steps —
 * blanking the `OrganizationUser` anchor and person references inside
 * `DiscoveredAgent.snapshot`, and deriving the email tokens this method is
 * handed — belong to the erasure service that ships with the read-path
 * batch.
 */
export class PrismaIdentityLinkStorage implements IdentityLinkStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async appendLink(input: AppendLinkInput): Promise<IdentityLinkRow> {
    const connection = await this.prisma.ingestionSource.findFirst({
      where: {
        id: input.providerConnectionId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!connection) {
      throw new Error(
        `Provider connection ${input.providerConnectionId} does not belong to organization ${input.organizationId}`,
      );
    }

    const created = await this.prisma.providerIdentityLink.create({
      data: {
        organizationId: input.organizationId,
        provider: input.provider,
        providerConnectionId: input.providerConnectionId,
        externalKind: input.externalKind,
        externalId: input.externalId,
        userId: input.userId,
        effectiveFrom: input.effectiveFrom,
        source: input.source,
        actorUserId: input.actorUserId,
      },
    });
    return toRow(created);
  }

  async eraseIdentifiers(
    input: EraseIdentifiersInput,
  ): Promise<EraseIdentifiersResult> {
    const { organizationId, userId, emailTokenByExternalId, erasedAt } = input;

    return await this.prisma.$transaction(async (tx) => {
      const touched = await tx.providerIdentityLink.findMany({
        where: {
          organizationId,
          OR: [
            { userId },
            { actorUserId: userId },
            // Same email value under a non-email kind (a collision, not a
            // person reference) must not be swapped or stamped.
            {
              externalKind: { in: [...EMAIL_EXTERNAL_KINDS] },
              externalId: { in: [...emailTokenByExternalId.keys()] },
            },
          ],
        },
        select: {
          id: true,
          userId: true,
          actorUserId: true,
          externalKind: true,
          externalId: true,
        },
      });

      for (const row of touched) {
        await tx.providerIdentityLink.update({
          where: { id: row.id },
          data: {
            userId: row.userId === userId ? null : row.userId,
            actorUserId: row.actorUserId === userId ? null : row.actorUserId,
            externalId:
              isEmailKind(row.externalKind) &&
              emailTokenByExternalId.has(row.externalId)
                ? emailTokenByExternalId.get(row.externalId)!
                : row.externalId,
            erasedAt,
          },
        });
      }

      return { linkRowsTouched: touched.length };
    });
  }

  async listLinksForLogins(
    organizationId: string,
    logins: readonly LoginRef[],
  ): Promise<IdentityLinkRow[]> {
    if (logins.length === 0) return [];
    const rows = await this.prisma.providerIdentityLink.findMany({
      where: {
        organizationId,
        OR: logins.map((login) => ({
          provider: login.provider,
          providerConnectionId: login.providerConnectionId,
          externalKind: login.externalKind,
          externalId: login.externalId,
        })),
      },
    });
    return rows.map(toRow);
  }
}
