// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  DISCOVERED_PERSON_KIND,
  DiscoveredPersonRepository,
  type DiscoveredPersonRow,
} from "../discovered-person.repository.ts";

export type DiscoveredPersonDatabase = Pick<PrismaClient, "discoveredPerson">;

type StoredDiscoveredPerson = Prisma.DiscoveredPersonGetPayload<object>;

function toRow(row: StoredDiscoveredPerson): DiscoveredPersonRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    rawActorId: row.rawActorId,
    displayText: row.displayText,
    kind: row.kind,
    department: row.department,
    firstSeenAt: fromDate(row.firstSeenAt),
    lastSeenAt: fromDate(row.lastSeenAt),
    erasedAt: row.erasedAt ? fromDate(row.erasedAt) : null,
    moneyRowsPendingAt: row.moneyRowsPendingAt ? fromDate(row.moneyRowsPendingAt) : null,
    moneyRebuildSince: row.moneyRebuildSince,
    suspendedAt: row.suspendedAt ? fromDate(row.suspendedAt) : null,
    suspendedReason: row.suspendedReason,
  };
}

/** Scoped by organization, not the hidden governance project, which can be archived away. */
export class PrismaDiscoveredPersonRepository extends DiscoveredPersonRepository {
  private constructor(private readonly prisma: DiscoveredPersonDatabase) {
    super();
  }

  static create(database: DiscoveredPersonDatabase): PrismaDiscoveredPersonRepository {
    return new PrismaDiscoveredPersonRepository(database);
  }

  async findById(input: {
    id: string;
    organizationId: string;
  }): Promise<DiscoveredPersonRow | null> {
    const row = await this.prisma.discoveredPerson.findFirst({ where: input });
    return row ? toRow(row) : null;
  }

  async findMatchable({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredPersonRow[]> {
    const rows = await this.prisma.discoveredPerson.findMany({
      where: {
        organizationId,
        kind: DISCOVERED_PERSON_KIND.PERSON,
        suspendedAt: null,
        erasedAt: null,
      },
      orderBy: { id: "asc" },
    });
    return rows.map(toRow);
  }

  async findByActorIds({
    organizationId,
    provider,
    rawActorIds,
  }: {
    organizationId: string;
    provider: string;
    rawActorIds: string[];
  }): Promise<{ id: string; rawActorId: string }[]> {
    if (rawActorIds.length === 0) return [];
    return this.prisma.discoveredPerson.findMany({
      where: { organizationId, provider, rawActorId: { in: rawActorIds } },
      select: { id: true, rawActorId: true },
    });
  }

  async findByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredPersonRow[]> {
    const rows = await this.prisma.discoveredPerson.findMany({
      where: { organizationId },
      orderBy: { lastSeenAt: "desc" },
    });
    return rows.map(toRow);
  }

  async recordActivitySighting(input: {
    organizationId: string;
    provider: string;
    rawActorId: string;
    displayText: string;
    kind: string;
    earliestAt: Instant;
    latestAt: Instant;
  }): Promise<void> {
    const key = {
      organizationId: input.organizationId,
      provider: input.provider,
      rawActorId: input.rawActorId,
    };
    const earliestAt = toDate(input.earliestAt);
    const latestAt = toDate(input.latestAt);
    // skipDuplicates, not a caught P2002: after the first run the duplicate is the common case.
    const created = await this.prisma.discoveredPerson.createMany({
      data: [
        {
          ...key,
          displayText: input.displayText,
          kind: input.kind,
          firstSeenAt: earliestAt,
          lastSeenAt: latestAt,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count > 0) return;
    await this.prisma.discoveredPerson.updateMany({
      where: { ...key, lastSeenAt: { lt: latestAt } },
      data: { lastSeenAt: latestAt },
    });
    await this.prisma.discoveredPerson.updateMany({
      where: { ...key, firstSeenAt: { gt: earliestAt } },
      data: { firstSeenAt: earliestAt },
    });
  }

  async recordDirectorySighting(input: {
    organizationId: string;
    provider: string;
    rawActorId: string;
    displayText: string;
    department: string;
    seenAt: Instant;
  }): Promise<void> {
    const key = {
      organizationId: input.organizationId,
      provider: input.provider,
      rawActorId: input.rawActorId,
    };
    const seenAt = toDate(input.seenAt);
    const created = await this.prisma.discoveredPerson.createMany({
      data: [
        {
          ...key,
          displayText: input.displayText,
          department: input.department === "" ? null : input.department,
          kind: DISCOVERED_PERSON_KIND.PERSON,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count > 0) return;

    // Only the fields this sighting named, and only where the row disagrees: most passes write nothing.
    const data: { displayText?: string; department?: string } = {};
    const differs: Prisma.DiscoveredPersonWhereInput[] = [];
    if (input.displayText !== "") {
      data.displayText = input.displayText;
      differs.push({ displayText: { not: input.displayText } });
    }
    if (input.department !== "") {
      data.department = input.department;
      differs.push({ OR: [{ department: null }, { department: { not: input.department } }] });
    }
    if (differs.length === 0) return;

    await this.prisma.discoveredPerson.updateMany({
      where: { ...key, erasedAt: null, OR: differs },
      data,
    });
  }

  async suspend({
    id,
    organizationId,
    at,
    reason,
  }: {
    id: string;
    organizationId: string;
    at: Instant;
    reason: string;
  }): Promise<number> {
    const result = await this.prisma.discoveredPerson.updateMany({
      where: { id, organizationId, suspendedAt: null },
      data: { suspendedAt: toDate(at), suspendedReason: reason },
    });
    return result.count;
  }

  async markMoneyRowsPending({
    id,
    organizationId,
    at,
    rebuildSince,
  }: {
    id: string;
    organizationId: string;
    at: Instant;
    rebuildSince: string | null;
  }): Promise<number> {
    const result = await this.prisma.discoveredPerson.updateMany({
      where: { id, organizationId },
      data: { moneyRowsPendingAt: toDate(at), moneyRebuildSince: rebuildSince },
    });
    return result.count;
  }

  async pseudonymize({
    id,
    organizationId,
    pseudonym,
    erasedAt,
  }: {
    id: string;
    organizationId: string;
    pseudonym: string;
    erasedAt: Instant;
  }): Promise<number> {
    const result = await this.prisma.discoveredPerson.updateMany({
      where: { id, organizationId },
      data: {
        rawActorId: pseudonym,
        displayText: pseudonym,
        department: null,
        erasedAt: toDate(erasedAt),
      },
    });
    return result.count;
  }

  async settleMoneyRows(input: { id: string; organizationId: string }): Promise<number> {
    const result = await this.prisma.discoveredPerson.updateMany({
      where: input,
      data: { moneyRowsPendingAt: null, moneyRebuildSince: null },
    });
    return result.count;
  }
}
