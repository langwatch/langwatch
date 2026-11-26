// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AGENT_REGISTRY_EVENT_TYPES,
  AgentRegistryEntryNotFoundError,
  type AgentRegistryEntry,
  type AgentRegistryEvent,
  type AgentRegistryPosture,
  type AgentRegistryStatus,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import {
  registryEventOf,
  storedRegistryEntryOf,
  storedRegistryEntrySchema,
  type RegistryChangeSet,
  type StoredRegistryEntry,
} from "../../features/registry/rules/registry-reconcile.rules.ts";
import {
  AgentRegistryRepository,
  type RegistryEntryPage,
  type RegistryEntryPosition,
  type RegistryEventPage,
} from "../agent-registry.repository.ts";

const logger = createLogger("langwatch:governance:prisma-agent-registry-repository");

/** A reconcile reads the sources first, so the lock is held only for the read-plan-write. */
const REGISTRY_TRANSACTION_TIMEOUT_MS = 30_000;
const REGISTRY_TRANSACTION_MAX_WAIT_MS = 10_000;

const eventPayloadSchema = z.object({
  tool: z.string().nullable(),
  agent: storedRegistryEntrySchema,
});

type EventRow = {
  id: string;
  organizationId: string;
  sequence: bigint;
  type: string;
  entryId: string;
  fromVersion: number | null;
  toVersion: number | null;
  payload: Prisma.JsonValue;
  occurredAt: Date;
};

function eventOf(row: EventRow): AgentRegistryEvent {
  return registryEventOfRow({
    row,
    type: eventTypeSchema.parse(row.type),
    payload: eventPayloadSchema.parse(row.payload),
  });
}

function registryEventOfRow({
  row,
  type,
  payload,
}: {
  row: EventRow;
  type: AgentRegistryEvent["type"];
  payload: z.infer<typeof eventPayloadSchema>;
}): AgentRegistryEvent {
  return registryEventOf({
    organizationId: row.organizationId,
    sequence: row.sequence,
    draft: {
      id: row.id,
      type,
      entryId: row.entryId,
      fromVersion: row.fromVersion,
      toVersion: row.toVersion,
      tool: payload.tool,
      agent: payload.agent,
      occurredAt: row.occurredAt.toISOString(),
    },
  });
}

/** A read skips an event another release wrote with a type or payload this one cannot read. */
function readableEventsOf(rows: readonly EventRow[]): AgentRegistryEvent[] {
  return rows.flatMap((row) => {
    const type = eventTypeSchema.safeParse(row.type);
    const payload = eventPayloadSchema.safeParse(row.payload);
    if (type.success && payload.success) {
      return [registryEventOfRow({ row, type: type.data, payload: payload.data })];
    }
    logger.warn(
      {
        eventId: row.id,
        type: row.type,
        paths: payload.success ? [] : payload.error.issues.map((issue) => issue.path.join(".")),
      },
      "Skipped an agent registry event this release cannot read",
    );
    return [];
  });
}

/** A full page passes on its last row's sequence, readable or not, so a reader pages past it. */
function eventPageOf({
  rows,
  limit,
}: {
  rows: readonly EventRow[];
  limit: number;
}): RegistryEventPage {
  const last = rows.at(-1);
  return {
    events: readableEventsOf(rows),
    next: rows.length === limit && last ? last.sequence : null,
  };
}

/** Whether the row was written by a release that stores the dormant flag. */
function isStoredWithDormancy(value: Prisma.JsonValue): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "dormant" in value;
}

function entryOf(value: Prisma.JsonValue): AgentRegistryEntry {
  return storedRegistryEntryOf(value);
}

/** A list skips an entry this release cannot read (a newer release's source) instead of failing. */
function readableEntriesOf(rows: { id: string; entry: Prisma.JsonValue }[]): AgentRegistryEntry[] {
  return rows.flatMap((row) => {
    const parsed = storedRegistryEntrySchema.safeParse(row.entry);
    if (parsed.success) return [parsed.data];
    logger.warn(
      { entryId: row.id, paths: parsed.error.issues.map((issue) => issue.path.join(".")) },
      "Skipped an agent registry entry this release cannot read",
    );
    return [];
  });
}

const eventTypeSchema = z.enum(AGENT_REGISTRY_EVENT_TYPES);

/**
 * Posture follows from the entry's `shadow` and `dormant`; a row stored before `dormant` existed
 * has no such key and reads as not dormant.
 */
function postureWhere(posture: AgentRegistryPosture): Prisma.AgentRegistryEntryWhereInput[] {
  const shadow = (value: boolean) => ({ entry: { path: ["shadow"], equals: value } });
  const dormant = (value: boolean | typeof Prisma.AnyNull) => ({
    entry: { path: ["dormant"], equals: value },
  });
  if (posture === "shadow") return [shadow(true)];
  if (posture === "dormant") return [shadow(false), dormant(true)];
  return [shadow(false), { OR: [dormant(false), dormant(Prisma.AnyNull)] }];
}
const inputJsonSchema = z.custom<Prisma.InputJsonValue>(
  (value) => value !== null && value !== undefined,
);

function jsonOf(value: unknown): Prisma.InputJsonValue {
  return inputJsonSchema.parse(JSON.parse(JSON.stringify(value)));
}

/** Writes the planned entry rows inside the reconcile's transaction. */
async function writeEntries({
  transaction,
  organizationId,
  writes,
}: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  writes: RegistryChangeSet["writes"];
}): Promise<void> {
  for (const write of writes) {
    const data = {
      source: write.entry.source,
      status: write.entry.status,
      version: write.entry.version,
      fingerprint: write.fingerprint,
      entry: jsonOf(write.entry),
      lastSeenAt: write.entry.last_seen_at ? new Date(write.entry.last_seen_at) : null,
      removedAt: write.entry.removed_at ? new Date(write.entry.removed_at) : null,
      updatedAt: new Date(write.entry.updated_at),
    };
    if (write.isNew) {
      await transaction.agentRegistryEntry.create({
        data: {
          ...data,
          id: write.id,
          organizationId,
          sourceKey: write.sourceKey,
          firstSeenAt: new Date(write.entry.first_seen_at),
        },
      });
    } else {
      await transaction.agentRegistryEntry.updateMany({
        where: { organizationId, id: write.id },
        data,
      });
    }
  }
}

export class PrismaAgentRegistryRepository extends AgentRegistryRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaAgentRegistryRepository {
    return new PrismaAgentRegistryRepository(prisma);
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
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw` ${skipTenantCheck({
          // Advisory-lock helper, the key names one organisation's registry.
          SKIP_TENANT_CHECK: true,
        })}
SELECT pg_advisory_xact_lock(hashtextextended(${`agent-registry:${organizationId}`}, 0))`;
        const rows = await transaction.agentRegistryEntry.findMany({
          where: { organizationId },
          select: { id: true, sourceKey: true, fingerprint: true, entry: true },
        });
        const changes = plan(
          rows.map((row) => ({
            ...row,
            entry: entryOf(row.entry),
            dormancyBaselined: isStoredWithDormancy(row.entry),
          })),
        );
        const baselined = await transaction.agentRegistryBaseline.findUnique({
          where: { organizationId },
          select: { organizationId: true },
        });
        const deliveryRecordedAt = baselined ? null : toDate(baselineAt);
        if (!baselined) {
          await transaction.agentRegistryBaseline.create({
            data: { organizationId, baselinedAt: toDate(baselineAt) },
          });
        }

        await writeEntries({ transaction, organizationId, writes: changes.writes });

        const appended: AgentRegistryEvent[] = [];
        for (const draft of changes.events) {
          const row = await transaction.agentRegistryEvent.create({
            data: {
              id: draft.id,
              organizationId,
              type: draft.type,
              entryId: draft.entryId,
              fromVersion: draft.fromVersion,
              toVersion: draft.toVersion,
              payload: jsonOf({ tool: draft.tool, agent: draft.agent }),
              occurredAt: toDate(draft.occurredAt),
              deliveryRecordedAt,
            },
          });
          appended.push(eventOf(row));
        }
        return appended;
      },
      { timeout: REGISTRY_TRANSACTION_TIMEOUT_MS, maxWait: REGISTRY_TRANSACTION_MAX_WAIT_MS },
    );
  }

  async findOrganizationIds({
    after,
    limit,
  }: {
    after?: string;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ organizationId: string }[]>`
      ${skipTenantCheck({
        // The traffic pass walks every organisation that holds a registry, by id.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT DISTINCT "organizationId" FROM "AgentRegistryEntry"
       WHERE "organizationId" > ${after ?? ""}
       ORDER BY "organizationId"
       LIMIT ${limit}
    `;
    return rows.map((row) => row.organizationId);
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
    const rows = await this.prisma.agentRegistryEntry.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      select: { id: true, entry: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return readableEntriesOf(rows);
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
    const rows = await this.prisma.agentRegistryEntry.findMany({
      where: {
        organizationId,
        status: "active",
        ...(afterSourceKey === undefined ? {} : { sourceKey: { gt: afterSourceKey } }),
      },
      select: { sourceKey: true, entry: true },
      orderBy: { sourceKey: "asc" },
      take: limit,
    });
    return rows.map((row) => ({ sourceKey: row.sourceKey, entry: entryOf(row.entry) }));
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
    const afterAt = after ? new Date(after.updatedAt) : undefined;
    const rows = await this.prisma.agentRegistryEntry.findMany({
      where: {
        organizationId,
        ...(status ? { status } : {}),
        ...(posture ? { AND: postureWhere(posture) } : {}),
        ...(updatedSince ? { updatedAt: { gte: toDate(updatedSince) } } : {}),
        ...(after && afterAt
          ? {
              OR: [{ updatedAt: { gt: afterAt } }, { updatedAt: afterAt, id: { gt: after.id } }],
            }
          : {}),
      },
      select: { id: true, updatedAt: true, entry: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      entries: readableEntriesOf(page),
      hasMore: rows.length > limit,
      ...(last ? { last: { updatedAt: last.updatedAt.toISOString(), id: last.id } } : {}),
    };
  }

  async getEntry({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<AgentRegistryEntry> {
    const row = await this.prisma.agentRegistryEntry.findFirst({
      where: { organizationId, id },
      select: { entry: true },
    });
    if (!row) throw new AgentRegistryEntryNotFoundError(id);
    return entryOf(row.entry);
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
    const rows = await this.prisma.agentRegistryEvent.findMany({
      where: { organizationId, ...(after === undefined ? {} : { sequence: { gt: after } }) },
      orderBy: { sequence: "asc" },
      take: limit,
    });
    return eventPageOf({ rows, limit });
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
    const rows = await this.prisma.agentRegistryEvent.findMany({
      where: {
        organizationId,
        entryId,
        ...(after === undefined ? {} : { sequence: { gt: after } }),
      },
      orderBy: { sequence: "asc" },
      take: limit,
    });
    return eventPageOf({ rows, limit });
  }

  async findUndeliveredEvents({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<AgentRegistryEvent[]> {
    // A type, or a payload, only a newer release reads stays undelivered for it; the read pages past.
    const events: AgentRegistryEvent[] = [];
    let after: bigint | undefined;
    let more = true;
    while (more && events.length < limit) {
      const rows = await this.prisma.agentRegistryEvent.findMany({
        where: {
          organizationId,
          deliveryRecordedAt: null,
          type: { in: [...AGENT_REGISTRY_EVENT_TYPES] },
          ...(after === undefined ? {} : { sequence: { gt: after } }),
        },
        orderBy: { sequence: "asc" },
        take: limit,
      });
      events.push(...readableEventsOf(rows));
      after = rows.at(-1)?.sequence;
      more = rows.length === limit && after !== undefined;
    }
    return events.slice(0, limit);
  }

  async findSourceKeys({
    organizationId,
    ids,
  }: {
    organizationId: string;
    ids: readonly string[];
  }): Promise<{ id: string; sourceKey: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.agentRegistryEntry.findMany({
      where: { organizationId, id: { in: [...ids] } },
      select: { id: true, sourceKey: true },
    });
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
    if (eventIds.length === 0) return;
    await this.prisma.agentRegistryEvent.updateMany({
      where: { organizationId, id: { in: [...eventIds] } },
      data: { deliveryRecordedAt: toDate(at) },
    });
  }
}
