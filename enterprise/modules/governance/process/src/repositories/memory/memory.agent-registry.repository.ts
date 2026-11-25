// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentRegistryEntryNotFoundError,
  agentRegistryEventSchema,
  type AgentRegistryEntry,
  type AgentRegistryEvent,
  type AgentRegistryPosture,
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
  type RegistryEntryPage,
  type RegistryEntryPosition,
  type RegistryEventPage,
} from "../agent-registry.repository.ts";

type MemoryRow = StoredRegistryEntry & { organizationId: string };
/** A stored row's `type` is a string, as in Postgres: another release may have written it. */
type StoredEvent = Omit<AgentRegistryEvent, "type"> & { type: string };
type MemoryEvent = { event: StoredEvent; deliveryRecordedAt: Instant | null };

/** As the Prisma repository: a full page passes on its last row, readable or not. */
function eventPageOf({
  held,
  limit,
}: {
  held: readonly MemoryEvent[];
  limit: number;
}): RegistryEventPage {
  const page = held.slice(0, limit);
  const last = page.at(-1);
  return {
    events: readableEventsOf(page),
    next: page.length === limit && last ? BigInt(last.event.sequence) : null,
  };
}

function readableEventsOf(held: readonly MemoryEvent[]): AgentRegistryEvent[] {
  return held.flatMap(({ event }) => {
    const parsed = agentRegistryEventSchema.safeParse(event);
    return parsed.success ? [structuredClone(parsed.data)] : [];
  });
}

function epochMsOf(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

function byPosition(a: AgentRegistryEntry, b: AgentRegistryEntry): number {
  return epochMsOf(a.updated_at) - epochMsOf(b.updated_at) || a.id.localeCompare(b.id);
}

export class MemoryAgentRegistryRepository extends AgentRegistryRepository {
  private readonly rows: MemoryRow[] = [];
  private readonly events: MemoryEvent[] = [];
  private readonly baselines = new Set<string>();
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
    baselineAt,
  }: {
    organizationId: string;
    plan: (stored: StoredRegistryEntry[]) => RegistryChangeSet;
    baselineAt: Instant;
  }): Promise<AgentRegistryEvent[]> {
    const deliveryRecordedAt = this.baselines.has(organizationId) ? null : baselineAt;
    this.baselines.add(organizationId);
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

  async findActiveWithSourceKeys({
    organizationId,
    limit,
    afterSourceKey,
  }: {
    organizationId: string;
    limit: number;
    afterSourceKey?: string;
  }): Promise<{ sourceKey: string; entry: AgentRegistryEntry }[]> {
    return this.rows
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          row.entry.status === "active" &&
          (afterSourceKey === undefined || row.sourceKey > afterSourceKey),
      )
      .toSorted((a, b) => Number(a.sourceKey > b.sourceKey) - Number(a.sourceKey < b.sourceKey))
      .slice(0, limit)
      .map((row) => ({ sourceKey: row.sourceKey, entry: structuredClone(row.entry) }));
  }

  async listEntries({
    organizationId,
    limit,
    after,
    updatedSince,
    status,
    posture,
  }: {
    organizationId: string;
    limit: number;
    after?: RegistryEntryPosition;
    updatedSince?: Instant;
    status?: AgentRegistryStatus;
    posture?: AgentRegistryPosture;
  }): Promise<RegistryEntryPage> {
    const matching = this.entriesOf(organizationId)
      .filter((entry) => !status || entry.status === status)
      .filter((entry) => !posture || entry.posture === posture)
      .filter(
        (entry) => !updatedSince || epochMsOf(entry.updated_at) >= updatedSince.epochMilliseconds,
      )
      .filter(
        (entry) =>
          !after || byPosition(entry, { ...entry, updated_at: after.updatedAt, id: after.id }) > 0,
      )
      .toSorted(byPosition);
    const entries = matching.slice(0, limit);
    const last = entries.at(-1);
    return {
      entries,
      hasMore: matching.length > limit,
      ...(last ? { last: { updatedAt: last.updated_at, id: last.id } } : {}),
    };
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

  async listEventsAfter({
    organizationId,
    after,
    limit,
  }: {
    organizationId: string;
    after?: bigint;
    limit: number;
  }): Promise<RegistryEventPage> {
    return eventPageOf({
      held: this.eventsOf(organizationId).filter(
        ({ event }) => after === undefined || BigInt(event.sequence) > after,
      ),
      limit,
    });
  }

  async listEventsOfEntry({
    organizationId,
    entryId,
    after,
    limit,
  }: {
    organizationId: string;
    entryId: string;
    after?: bigint;
    limit: number;
  }): Promise<RegistryEventPage> {
    return eventPageOf({
      held: this.eventsOf(organizationId)
        .filter(({ event }) => event.agent_id === entryId)
        .filter(({ event }) => after === undefined || BigInt(event.sequence) > after),
      limit,
    });
  }

  async findUndeliveredEvents({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<AgentRegistryEvent[]> {
    return readableEventsOf(
      this.eventsOf(organizationId).filter(({ deliveryRecordedAt }) => deliveryRecordedAt === null),
    ).slice(0, limit);
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

  async findSourceKeys({
    organizationId,
    ids,
  }: {
    organizationId: string;
    ids: readonly string[];
  }): Promise<{ id: string; sourceKey: string }[]> {
    return this.rows
      .filter((row) => row.organizationId === organizationId && ids.includes(row.id))
      .map((row) => ({ id: row.id, sourceKey: row.sourceKey }));
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
