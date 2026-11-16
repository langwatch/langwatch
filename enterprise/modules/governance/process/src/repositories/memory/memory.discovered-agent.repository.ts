// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import { Temporal, type Instant } from "@langwatch/time";

import { mergeAgentMetadata } from "../../features/agents/rules/discovered-agent-metadata.rules.ts";
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
    return this.store.agents
      .filter((agent) => agent.organizationId === organizationId && !agent.goneAt)
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
    return this.store.agents
      .filter((agent) => agent.organizationId === organizationId && !agent.goneAt)
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
    if (!existing) {
      this.store.agents.push({
        id: generate("agent").toString(),
        organizationId: input.organizationId,
        provider: input.provider,
        rawAgentId: input.rawAgentId,
        displayText: input.displayText,
        metadata: { ...input.metadata },
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
        ingestionSourceId: input.ingestionSourceId ?? null,
        goneAt: null,
      });
      return;
    }
    existing.goneAt = null;
    if (input.ingestionSourceId !== undefined) existing.ingestionSourceId = input.ingestionSourceId;
    if (Temporal.Instant.compare(existing.lastSeenAt, input.seenAt) < 0)
      existing.lastSeenAt = input.seenAt;
    if (Temporal.Instant.compare(existing.firstSeenAt, input.seenAt) > 0)
      existing.firstSeenAt = input.seenAt;
    if (input.displayText !== "") existing.displayText = input.displayText;
    const merged = mergeAgentMetadata({ stored: existing.metadata, incoming: input.metadata });
    if (merged.changed) existing.metadata = merged.metadata;
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
    for (const agent of this.store.agents) {
      const isUnlisted =
        agent.organizationId === organizationId &&
        agent.ingestionSourceId === ingestionSourceId &&
        !agent.goneAt &&
        Temporal.Instant.compare(agent.lastSeenAt, listedAt) < 0;
      if (!isUnlisted) continue;
      agent.goneAt = listedAt;
      marked++;
    }
    return { marked };
  }
}
