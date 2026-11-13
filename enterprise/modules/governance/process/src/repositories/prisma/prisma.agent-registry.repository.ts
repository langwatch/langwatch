// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentRegistryEntryNotFoundError,
  agentRegistryEntrySchema,
  type AgentRegistryEntry,
  type AgentRegistryEvent,
  type AgentRegistryEventType,
  type AgentRegistryStatus,
} from "@langwatch/enterprise-governance-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import {
  registryEventOf,
  type RegistryChangeSet,
  type StoredRegistryEntry,
} from "../../features/registry/rules/registry-reconcile.rules.ts";
import {
  AgentRegistryRepository,
  type RegistryEntryPosition,
} from "../agent-registry.repository.ts";

/** A reconcile reads the sources first, so the lock is held only for the read-plan-write. */
const REGISTRY_TRANSACTION_TIMEOUT_MS = 30_000;
const REGISTRY_TRANSACTION_MAX_WAIT_MS = 10_000;

const eventPayloadSchema = z.object({
  tool: z.string().nullable(),
  agent: agentRegistryEntrySchema,
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
  const payload = eventPayloadSchema.parse(row.payload);
  return registryEventOf({
    organizationId: row.organizationId,
    sequence: row.sequence,
    draft: {
      id: row.id,
      type: row.type as AgentRegistryEventType,
      entryId: row.entryId,
      fromVersion: row.fromVersion,
      toVersion: row.toVersion,
      tool: payload.tool,
      agent: payload.agent,
      occurredAt: row.occurredAt.toISOString(),
    },
  });
}

function entryOf(value: Prisma.JsonValue): AgentRegistryEntry {
  return agentRegistryEntrySchema.parse(value);
}

function jsonOf(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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
  }: {
    organizationId: string;
    plan: (stored: StoredRegistryEntry[]) => RegistryChangeSet;
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
        const changes = plan(rows.map((row) => ({ ...row, entry: entryOf(row.entry) })));

        for (const write of changes.writes) {
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

  async findEntries({ organizationId }: { organizationId: string }): Promise<AgentRegistryEntry[]> {
    const rows = await this.prisma.agentRegistryEntry.findMany({
      where: { organizationId },
      select: { entry: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => entryOf(row.entry));
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
    const afterAt = after ? new Date(after.updatedAt) : undefined;
    const rows = await this.prisma.agentRegistryEntry.findMany({
      where: {
        organizationId,
        ...(status ? { status } : {}),
        ...(updatedSince ? { updatedAt: { gte: toDate(updatedSince) } } : {}),
        ...(after && afterAt
          ? {
              OR: [{ updatedAt: { gt: afterAt } }, { updatedAt: afterAt, id: { gt: after.id } }],
            }
          : {}),
      },
      select: { entry: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    return {
      entries: rows.slice(0, limit).map((row) => entryOf(row.entry)),
      hasMore: rows.length > limit,
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

  async findEventsAfter({
    organizationId,
    after,
    limit,
  }: {
    organizationId: string;
    after?: bigint;
    limit: number;
  }): Promise<AgentRegistryEvent[]> {
    const rows = await this.prisma.agentRegistryEvent.findMany({
      where: { organizationId, ...(after === undefined ? {} : { sequence: { gt: after } }) },
      orderBy: { sequence: "asc" },
      take: limit,
    });
    return rows.map(eventOf);
  }

  async findEventsOfEntry({
    organizationId,
    entryId,
  }: {
    organizationId: string;
    entryId: string;
  }): Promise<AgentRegistryEvent[]> {
    const rows = await this.prisma.agentRegistryEvent.findMany({
      where: { organizationId, entryId },
      orderBy: { sequence: "asc" },
    });
    return rows.map(eventOf);
  }

  async findUndeliveredEvents({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<AgentRegistryEvent[]> {
    const rows = await this.prisma.agentRegistryEvent.findMany({
      where: { organizationId, deliveryRecordedAt: null },
      orderBy: { sequence: "asc" },
      take: limit,
    });
    return rows.map(eventOf);
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
