// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  IdentityMatchRepository,
  type IdentityMatchRow,
  type OpenIdentityMatch,
} from "../identity-match.repository.ts";

export type IdentityMatchDatabase = Pick<PrismaClient, "identityMatch">;

type StoredIdentityMatch = Omit<IdentityMatchRow, "validFrom" | "validTo"> & {
  validFrom: Date;
  validTo: Date | null;
};

function toRow(row: StoredIdentityMatch): IdentityMatchRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    discoveredPersonId: row.discoveredPersonId,
    userId: row.userId,
    evidenceKind: row.evidenceKind,
    validFrom: fromDate(row.validFrom),
    validTo: row.validTo ? fromDate(row.validTo) : null,
  };
}

export class PrismaIdentityMatchRepository extends IdentityMatchRepository {
  private constructor(private readonly prisma: IdentityMatchDatabase) {
    super();
  }

  static create(database: IdentityMatchDatabase): PrismaIdentityMatchRepository {
    return new PrismaIdentityMatchRepository(database);
  }

  async findAllByDiscoveredPerson(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<IdentityMatchRow[]> {
    const rows = await this.prisma.identityMatch.findMany({
      where: input,
      orderBy: { validFrom: "asc" },
    });
    return rows.map(toRow);
  }

  findOpenByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OpenIdentityMatch[]> {
    return this.prisma.identityMatch.findMany({
      where: { organizationId, validTo: null, userId: { not: null } },
      select: { discoveredPersonId: true, userId: true, evidenceKind: true },
    });
  }

  async open(input: {
    organizationId: string;
    discoveredPersonId: string;
    userId: string;
    evidenceKind: string;
    validFrom: Instant;
  }): Promise<IdentityMatchRow> {
    const row = await this.prisma.identityMatch.create({
      data: { ...input, validFrom: toDate(input.validFrom) },
    });
    return toRow(row);
  }

  async blankUserReferences(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<number> {
    const result = await this.prisma.identityMatch.updateMany({
      where: { ...input, userId: { not: null } },
      data: { userId: null },
    });
    return result.count;
  }
}
