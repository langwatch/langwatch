// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import { Temporal, type Instant } from "@langwatch/time";

import { mergeAgentMetadata } from "../../features/agents/rules/discovered-agent-metadata.rules.ts";
import { agentIdsGoneFromEverySource } from "../../features/agents/rules/discovered-agent-presence.rules.ts";
import {
  type DiscoveredAgentRegistryRow,
  DiscoveredAgentRepository,
  type DiscoveredAgentRow,
} from "../discovered-agent.repository.ts";
import type { MemoryDiscoveredPeopleStore } from "./memory.discovered-people.store.ts";

export class MemoryDiscoveredAgentRepository extends DiscoveredAgentRepository {
  private constructor(private readonly store: MemoryDiscoveredPeopleStore) {
    super();
  }

  static create(store: MemoryDiscoveredPeopleStore): MemoryDiscoveredAgentRepository {
    return new MemoryDiscoveredAgentRepository(store);
  }

  async findByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredAgentRow[]> {
    const gone = this.goneAgentIds({ organizationId });
    return this.store.agents
      .filter((agent) => agent.organizationId === organizationId && !gone.has(agent.id))
      .toSorted((a, b) => Temporal.Instant.compare(b.lastSeenAt, a.lastSeenAt))
      .map(({ id, provider, displayText, firstSeenAt, lastSeenAt }) => ({
        id,
        provider,
        displayText,
        firstSeenAt,
        lastSeenAt,
      }));
  }

  async findForRegistry({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DiscoveredAgentRegistryRow[]> {
    const gone = this.goneAgentIds({ organizationId });
    return this.store.agents
      .filter((agent) => agent.organizationId === organizationId && !gone.has(agent.id))
      .map(({ id, provider, rawAgentId, displayText, metadata, firstSeenAt, lastSeenAt }) => ({
        id,
        provider,
        rawAgentId,
        displayText,
        metadata: { ...metadata },
        firstSeenAt,
        lastSeenAt,
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
    const existing = this.store.agents.find(
      (agent) =>
        agent.organizationId === input.organizationId &&
        agent.provider === input.provider &&
        agent.rawAgentId === input.rawAgentId,
    );
    const agent = existing ?? this.createAgent(input);
    if (existing) {
      if (Temporal.Instant.compare(existing.lastSeenAt, input.seenAt) < 0)
        existing.lastSeenAt = input.seenAt;
      if (Temporal.Instant.compare(existing.firstSeenAt, input.seenAt) > 0)
        existing.firstSeenAt = input.seenAt;
      if (input.displayText !== "") existing.displayText = input.displayText;
      const merged = mergeAgentMetadata({ stored: existing.metadata, incoming: input.metadata });
      if (merged.changed) existing.metadata = merged.metadata;
    }
    if (input.ingestionSourceId === undefined) return;
    this.recordListing({
      organizationId: input.organizationId,
      ingestionSourceId: input.ingestionSourceId,
      discoveredAgentId: agent.id,
      listedAt: input.seenAt,
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
    let marked = 0;
    for (const listing of this.store.agentListings) {
      const isUnlisted =
        listing.organizationId === organizationId &&
        listing.ingestionSourceId === ingestionSourceId &&
        (listing.goneAt === null || Temporal.Instant.compare(listing.goneAt, listedAt) < 0) &&
        Temporal.Instant.compare(listing.lastListedAt, listedAt) < 0;
      if (!isUnlisted) continue;
      listing.goneAt = listedAt;
      marked++;
    }
    return { marked };
  }

  private goneAgentIds({ organizationId }: { organizationId: string }): Set<string> {
    return agentIdsGoneFromEverySource({
      listings: this.store.agentListings
        .filter((listing) => listing.organizationId === organizationId)
        .map((listing) => ({
          discoveredAgentId: listing.discoveredAgentId,
          isGone: listing.goneAt !== null,
        })),
    });
  }

  private createAgent(input: {
    organizationId: string;
    provider: string;
    rawAgentId: string;
    displayText: string;
    metadata: Record<string, string>;
    seenAt: Instant;
  }): { id: string } {
    const agent = {
      id: generate("agent").toString(),
      organizationId: input.organizationId,
      provider: input.provider,
      rawAgentId: input.rawAgentId,
      displayText: input.displayText,
      metadata: { ...input.metadata },
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
    };
    this.store.agents.push(agent);
    return agent;
  }

  private recordListing(input: {
    organizationId: string;
    ingestionSourceId: string;
    discoveredAgentId: string;
    listedAt: Instant;
  }): void {
    const existing = this.store.agentListings.find(
      (listing) =>
        listing.ingestionSourceId === input.ingestionSourceId &&
        listing.discoveredAgentId === input.discoveredAgentId,
    );
    if (!existing) {
      this.store.agentListings.push({
        organizationId: input.organizationId,
        ingestionSourceId: input.ingestionSourceId,
        discoveredAgentId: input.discoveredAgentId,
        lastListedAt: input.listedAt,
        goneAt: null,
      });
      return;
    }
    if (Temporal.Instant.compare(existing.lastListedAt, input.listedAt) > 0) return;
    if (existing.goneAt && Temporal.Instant.compare(existing.goneAt, input.listedAt) > 0) return;
    existing.lastListedAt = input.listedAt;
    existing.goneAt = null;
  }
}
