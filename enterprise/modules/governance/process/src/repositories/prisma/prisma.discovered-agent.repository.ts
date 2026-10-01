// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  type AgentMetadata,
  mergeAgentMetadata,
} from "../../rules/discovered-agent-metadata.rules.ts";
import {
  DiscoveredAgentRepository,
  type DiscoveredAgentRow,
} from "../discovered-agent.repository.ts";

export type DiscoveredAgentDatabase = Pick<PrismaClient, "discoveredAgent">;

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
    return rows.map((row) => ({
      ...row,
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
  }): Promise<void> {
    const key = {
      organizationId: input.organizationId,
      provider: input.provider,
      rawAgentId: input.rawAgentId,
    };
    const seenAt = toDate(input.seenAt);
    const created = await this.prisma.discoveredAgent.createMany({
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
    if (created.count > 0) return;

    await this.prisma.discoveredAgent.updateMany({
      where: { ...key, lastSeenAt: { lt: seenAt } },
      data: { lastSeenAt: seenAt },
    });
    await this.prisma.discoveredAgent.updateMany({
      where: { ...key, firstSeenAt: { gt: seenAt } },
      data: { firstSeenAt: seenAt },
    });

    const existing = await this.prisma.discoveredAgent.findFirst({
      where: key,
      select: { displayText: true, metadata: true },
    });
    if (!existing) return;

    const merged = mergeAgentMetadata({ stored: existing.metadata, incoming: input.metadata });
    const data: { displayText?: string; metadata?: AgentMetadata } = {};
    if (input.displayText !== "" && input.displayText !== existing.displayText) {
      data.displayText = input.displayText;
    }
    if (merged.changed) data.metadata = merged.metadata;
    if (Object.keys(data).length === 0) return;

    await this.prisma.discoveredAgent.updateMany({ where: key, data });
  }
}
