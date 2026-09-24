// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  IdentityMatchSuggestionRepository,
  type IdentityMatchSuggestionRow,
} from "../identity-match-suggestion.repository.ts";

export type IdentityMatchSuggestionDatabase = Pick<
  PrismaClient,
  "identityMatchSuggestion" | "$transaction"
>;

function toRow(row: Omit<IdentityMatchSuggestionRow, "computedAt"> & { computedAt: Date }) {
  return { ...row, computedAt: fromDate(row.computedAt) };
}

export class PrismaIdentityMatchSuggestionRepository extends IdentityMatchSuggestionRepository {
  private constructor(private readonly prisma: IdentityMatchSuggestionDatabase) {
    super();
  }

  static create(
    database: IdentityMatchSuggestionDatabase,
  ): PrismaIdentityMatchSuggestionRepository {
    return new PrismaIdentityMatchSuggestionRepository(database);
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<IdentityMatchSuggestionRow[]> {
    const rows = await this.prisma.identityMatchSuggestion.findMany({
      where: { organizationId },
      orderBy: [{ score: "desc" }, { id: "asc" }],
    });
    return rows.map(toRow);
  }

  async findOne(input: {
    id: string;
    organizationId: string;
  }): Promise<IdentityMatchSuggestionRow | null> {
    const row = await this.prisma.identityMatchSuggestion.findFirst({ where: input });
    return row ? toRow(row) : null;
  }

  /** One transaction, so a reviewer never sees an empty queue mid-pass. */
  replaceForOrganization({
    organizationId,
    suggestions,
    computedAt,
  }: {
    organizationId: string;
    suggestions: { discoveredPersonId: string; userId: string; score: number }[];
    computedAt: Instant;
  }): Promise<{ removed: number; written: number }> {
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.identityMatchSuggestion.deleteMany({ where: { organizationId } });
      if (suggestions.length === 0) return { removed: removed.count, written: 0 };
      // skipDuplicates: two overlapping passes collide on the unique rather than double.
      const written = await tx.identityMatchSuggestion.createMany({
        data: suggestions.map((suggestion) => ({
          organizationId,
          ...suggestion,
          computedAt: toDate(computedAt),
        })),
        skipDuplicates: true,
      });
      return { removed: removed.count, written: written.count };
    });
  }

  async deleteAllForPerson(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<number> {
    const result = await this.prisma.identityMatchSuggestion.deleteMany({ where: input });
    return result.count;
  }
}
