// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  type AgentMetadata,
  mergeAgentMetadata,
} from "../../features/agents/rules/discovered-agent-metadata.rules.ts";
import { agentIdsGoneFromEverySource } from "../../features/agents/rules/discovered-agent-presence.rules.ts";
import {
  type DiscoveredAgentRegistryRow,
  DiscoveredAgentRepository,
  type DiscoveredAgentRow,
} from "../discovered-agent.repository.ts";

type DiscoveredAgentDatabase = Pick<
  PrismaClient,
  "discoveredAgent" | "discoveredAgentListing" | "$transaction"
>;
type SightingWriter = Pick<Prisma.TransactionClient, "discoveredAgent" | "discoveredAgentListing">;

export class PrismaDiscoveredAgentRepository extends DiscoveredAgentRepository {
  private constructor(private readonly prisma: DiscoveredAgentDatabase) {
    super();
  }

  static create(database: DiscoveredAgentDatabase): PrismaDiscoveredAgentRepository {
    return new PrismaDiscoveredAgentRepository(database);
  }

  async findByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredAgentRow[]> {
    const rows = await this.prisma.discoveredAgent.findMany({
      where: { organizationId },
      select: { id: true, provider: true, displayText: true, firstSeenAt: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
    });
    const gone = await this.goneAgentIds({ organizationId });
    return rows
      .filter((row) => !gone.has(row.id))
      .map((row) => ({
        ...row,
        firstSeenAt: fromDate(row.firstSeenAt),
        lastSeenAt: fromDate(row.lastSeenAt),
      }));
  }

  async findForRegistry({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredAgentRegistryRow[]> {
    const rows = await this.prisma.discoveredAgent.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        rawAgentId: true,
        displayText: true,
        metadata: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
      orderBy: { id: "asc" },
    });
    const gone = await this.goneAgentIds({ organizationId });
    return rows
      .filter((row) => !gone.has(row.id))
      .map((row) => ({
        ...row,
        metadata:
          row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {},
        firstSeenAt: fromDate(row.firstSeenAt),
        lastSeenAt: fromDate(row.lastSeenAt),
      }));
  }

  async recordAgentSighting(input: {
    organizationId: string;
    provider: string;
    rawAgentId: string;
    displayText: string;
    metadata: Record<string, string>;
    seenAt: Instant;
    ingestionSourceId?: string;
  }): Promise<void> {
    const key = {
      organizationId: input.organizationId,
      provider: input.provider,
      rawAgentId: input.rawAgentId,
    };
    const seenAt = toDate(input.seenAt);
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.discoveredAgent.createMany({
        data: [
          {
            ...key,
            displayText: input.displayText,
            metadata: input.metadata,
            firstSeenAt: seenAt,
            lastSeenAt: seenAt,
          },
        ],
        skipDuplicates: true,
      });
      const agentId =
        created.count > 0
          ? await this.agentIdOf({ db: tx, key, needed: input.ingestionSourceId !== undefined })
          : await this.mergeSighting({ db: tx, key, input, seenAt });
      if (agentId === undefined || input.ingestionSourceId === undefined) return;
      await this.recordListing({
        db: tx,
        organizationId: input.organizationId,
        ingestionSourceId: input.ingestionSourceId,
        discoveredAgentId: agentId,
        listedAt: seenAt,
      });
    });
  }

  async markUnlistedGone({
    organizationId,
    ingestionSourceId,
    listedAt,
  }: {
    organizationId: string;
    ingestionSourceId: string;
    listedAt: Instant;
  }): Promise<{ marked: number }> {
    const at = toDate(listedAt);
    const { count } = await this.prisma.discoveredAgentListing.updateMany({
      where: {
        organizationId,
        ingestionSourceId,
        lastListedAt: { lt: at },
        OR: [{ goneAt: null }, { goneAt: { lt: at } }],
      },
      data: { goneAt: at },
    });
    return { marked: count };
  }

  private async goneAgentIds({ organizationId }: { organizationId: string }): Promise<Set<string>> {
    const listings = await this.prisma.discoveredAgentListing.findMany({
      where: { organizationId },
      select: { discoveredAgentId: true, goneAt: true },
    });
    return agentIdsGoneFromEverySource({
      listings: listings.map((listing) => ({
        discoveredAgentId: listing.discoveredAgentId,
        isGone: listing.goneAt !== null,
      })),
    });
  }

  private async agentIdOf({
    db,
    key,
    needed,
  }: {
    db: SightingWriter;
    key: { organizationId: string; provider: string; rawAgentId: string };
    needed: boolean;
  }): Promise<string | undefined> {
    if (!needed) return undefined;
    const row = await db.discoveredAgent.findFirst({ where: key, select: { id: true } });
    return row?.id;
  }

  /** Widens the seen range and merges text and metadata into the existing row; answers its id. */
  private async mergeSighting({
    db,
    key,
    input,
    seenAt,
  }: {
    db: SightingWriter;
    key: { organizationId: string; provider: string; rawAgentId: string };
    input: { displayText: string; metadata: Record<string, string> };
    seenAt: Date;
  }): Promise<string | undefined> {
    await db.discoveredAgent.updateMany({
      where: { ...key, lastSeenAt: { lt: seenAt } },
      data: { lastSeenAt: seenAt },
    });
    await db.discoveredAgent.updateMany({
      where: { ...key, firstSeenAt: { gt: seenAt } },
      data: { firstSeenAt: seenAt },
    });

    const existing = await db.discoveredAgent.findFirst({
      where: key,
      select: { id: true, displayText: true, metadata: true },
    });
    if (!existing) return undefined;

    const merged = mergeAgentMetadata({ stored: existing.metadata, incoming: input.metadata });
    const data: { displayText?: string; metadata?: AgentMetadata } = {};
    if (input.displayText !== "" && input.displayText !== existing.displayText) {
      data.displayText = input.displayText;
    }
    if (merged.changed) data.metadata = merged.metadata;
    if (Object.keys(data).length > 0) {
      await db.discoveredAgent.updateMany({ where: key, data });
    }
    return existing.id;
  }

  /** The source's presence for the agent: created once, then moved forward. Only a sighting
   * newer than the disappearance clears it. */
  private async recordListing({
    db,
    organizationId,
    ingestionSourceId,
    discoveredAgentId,
    listedAt,
  }: {
    organizationId: string;
    ingestionSourceId: string;
    discoveredAgentId: string;
    db: SightingWriter;
    listedAt: Date;
  }): Promise<void> {
    const created = await db.discoveredAgentListing.createMany({
      data: [{ organizationId, ingestionSourceId, discoveredAgentId, lastListedAt: listedAt }],
      skipDuplicates: true,
    });
    if (created.count > 0) return;
    await db.discoveredAgentListing.updateMany({
      where: {
        organizationId,
        ingestionSourceId,
        discoveredAgentId,
        lastListedAt: { lte: listedAt },
        OR: [{ goneAt: null }, { goneAt: { lte: listedAt } }],
      },
      data: { lastListedAt: listedAt, goneAt: null },
    });
  }
}
