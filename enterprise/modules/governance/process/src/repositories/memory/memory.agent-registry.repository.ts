// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentRegistryEntryNotFoundError,
  type AgentRegistryEntry,
  type AgentRegistryEvent,
  type AgentRegistryStatus,
} from "@langwatch/enterprise-governance-contract";
import { Temporal, type Instant } from "@langwatch/time";

import {
  registryEventOf,
  registryTimestamp,
  type RegistryChangeSet,
  type StoredRegistryEntry,
} from "../../features/registry/rules/registry-reconcile.rules.ts";
import {
  AgentRegistryRepository,
  type RegistryEntryPosition,
} from "../agent-registry.repository.ts";

type MemoryRow = StoredRegistryEntry & { organizationId: string };
type MemoryEvent = { event: AgentRegistryEvent; deliveryRecordedAt: Instant | null };

function epochMsOf(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

function byPosition(a: AgentRegistryEntry, b: AgentRegistryEntry): number {
  return epochMsOf(a.updated_at) - epochMsOf(b.updated_at) || a.id.localeCompare(b.id);
}

export class MemoryAgentRegistryRepository extends AgentRegistryRepository {
  private readonly rows: MemoryRow[] = [];
  private readonly events: MemoryEvent[] = [];
  private sequence = 0n;

  private constructor() {
    super();
  }

  static create(): MemoryAgentRegistryRepository {
    return new MemoryAgentRegistryRepository();
  }

  async applyChanges({
    organizationId,
    plan,
    deliveryRecordedAt = null,
  }: {
    organizationId: string;
    plan: (stored: StoredRegistryEntry[]) => RegistryChangeSet;
    deliveryRecordedAt?: Instant | null;
  }): Promise<AgentRegistryEvent[]> {
    const stored = this.rows
      .filter((row) => row.organizationId === organizationId)
      .map(({ id, sourceKey, fingerprint, entry }) => ({ id, sourceKey, fingerprint, entry }));
    const changes = plan(structuredClone(stored));
    for (const write of changes.writes) {
      const index = this.rows.findIndex(
        (row) => row.organizationId === organizationId && row.id === write.id,
      );
      const row = { organizationId, ...write };
      if (index === -1) this.rows.push(row);
      else this.rows[index] = row;
    }
    return changes.events.map((draft) => {
      this.sequence += 1n;
      const event = registryEventOf({
        organizationId,
        sequence: this.sequence,
        draft: { ...draft, occurredAt: registryTimestamp(draft.occurredAt) },
      });
      this.events.push({ event, deliveryRecordedAt });
      return event;
    });
  }

  async findOrganizationIds({
    after,
    limit,
  }: {
    after?: string;
    limit: number;
  }): Promise<string[]> {
    return [...new Set(this.rows.map((row) => row.organizationId))]
      .toSorted()
      .filter((id) => after === undefined || id > after)
      .slice(0, limit);
  }

  async findEntries({
    organizationId,
    status,
    limit,
  }: {
    organizationId: string;
    status?: AgentRegistryStatus;
    limit: number;
  }): Promise<AgentRegistryEntry[]> {
    return this.entriesOf(organizationId)
      .filter((entry) => !status || entry.status === status)
      .toSorted((a, b) => byPosition(b, a))
      .slice(0, limit);
  }

  async listEntries({
    organizationId,
    limit,
    after,
    updatedSince,
    status,
  }: {
    organizationId: string;
    limit: number;
    after?: RegistryEntryPosition;
    updatedSince?: Instant;
    status?: AgentRegistryStatus;
  }): Promise<{ entries: AgentRegistryEntry[]; hasMore: boolean }> {
    const matching = this.entriesOf(organizationId)
      .filter((entry) => !status || entry.status === status)
      .filter(
        (entry) => !updatedSince || epochMsOf(entry.updated_at) >= updatedSince.epochMilliseconds,
      )
      .filter(
        (entry) =>
          !after || byPosition(entry, { ...entry, updated_at: after.updatedAt, id: after.id }) > 0,
      )
      .toSorted(byPosition);
    return { entries: matching.slice(0, limit), hasMore: matching.length > limit };
  }

  async getEntry({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<AgentRegistryEntry> {
    const found = this.entriesOf(organizationId).find((entry) => entry.id === id);
    if (!found) throw new AgentRegistryEntryNotFoundError(id);
    return found;
  }

  async findEventsAfter({
    organizationId,
    after,
    limit,
  }: {
    organizationId: string;
    after?: bigint;
    limit: number;
  }): Promise<AgentRegistryEvent[]> {
    return this.eventsOf(organizationId)
      .filter(({ event }) => after === undefined || BigInt(event.sequence) > after)
      .slice(0, limit)
      .map(({ event }) => structuredClone(event));
  }

  async findEventsOfEntry({
    organizationId,
    entryId,
    after,
    limit,
  }: {
    organizationId: string;
    entryId: string;
    after?: bigint;
    limit: number;
  }): Promise<AgentRegistryEvent[]> {
    return this.eventsOf(organizationId)
      .filter(({ event }) => event.agent_id === entryId)
      .filter(({ event }) => after === undefined || BigInt(event.sequence) > after)
      .slice(0, limit)
      .map(({ event }) => structuredClone(event));
  }

  async findUndeliveredEvents({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<AgentRegistryEvent[]> {
    return this.eventsOf(organizationId)
      .filter(({ deliveryRecordedAt }) => deliveryRecordedAt === null)
      .slice(0, limit)
      .map(({ event }) => structuredClone(event));
  }

  async markDeliveryRecorded({
    organizationId,
    eventIds,
    at,
  }: {
    organizationId: string;
    eventIds: readonly string[];
    at: Instant;
  }): Promise<void> {
    const ids = new Set(eventIds);
    for (const held of this.eventsOf(organizationId)) {
      if (ids.has(held.event.id)) held.deliveryRecordedAt = at;
    }
  }

  private entriesOf(organizationId: string): AgentRegistryEntry[] {
    return this.rows
      .filter((row) => row.organizationId === organizationId)
      .map((row) => structuredClone(row.entry));
  }

  private eventsOf(organizationId: string): MemoryEvent[] {
    return this.events.filter(({ event }) => event.organization_id === organizationId);
  }
}
