// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";

import {
  ErasedIdentifierSuppressionRepository,
  type ErasedIdentifierSuppressionRow,
} from "../erased-identifier-suppression.repository.ts";

export type ErasedIdentifierSuppressionDatabase = Pick<PrismaClient, "erasedIdentifierSuppression">;

const ROW = { organizationId: true, provider: true, identifierHash: true } as const;

export class PrismaErasedIdentifierSuppressionRepository extends ErasedIdentifierSuppressionRepository {
  private constructor(private readonly prisma: ErasedIdentifierSuppressionDatabase) {
    super();
  }

  static create(
    database: ErasedIdentifierSuppressionDatabase,
  ): PrismaErasedIdentifierSuppressionRepository {
    return new PrismaErasedIdentifierSuppressionRepository(database);
  }

  findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ErasedIdentifierSuppressionRow[]> {
    return this.prisma.erasedIdentifierSuppression.findMany({
      where: { organizationId },
      select: ROW,
    });
  }

  findAll(): Promise<ErasedIdentifierSuppressionRow[]> {
    return this.prisma.erasedIdentifierSuppression.findMany({ select: ROW });
  }

  async recordAll({
    organizationId,
    provider,
    identifierHashes,
    erasedAt,
  }: {
    organizationId: string;
    provider: string;
    identifierHashes: string[];
    erasedAt: Instant;
  }): Promise<number> {
    if (identifierHashes.length === 0) return 0;
    const result = await this.prisma.erasedIdentifierSuppression.createMany({
      data: identifierHashes.map((identifierHash) => ({
        organizationId,
        provider,
        identifierHash,
        erasedAt: toDate(erasedAt),
      })),
      skipDuplicates: true,
    });
    return result.count;
  }
}
