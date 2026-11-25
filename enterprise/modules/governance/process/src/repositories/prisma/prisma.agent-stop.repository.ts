// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentStopNotFoundError,
  type AgentStopStatus,
  agentStopTargetOutcomeSchema,
} from "@langwatch/enterprise-governance-contract";
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import type { AgentStopProjectionState } from "../../features/kill-switch/eventing/agent-stop.projection.ts";
import {
  AGENT_STOP_PROJECTION_VERSION,
  type AgentStopRecord,
  agentStopRecordSchema,
} from "../../features/kill-switch/rules/agent-stop.rules.ts";
import { type AgentStopPosition, AgentStopRepository } from "../agent-stop.repository.ts";

type AgentStopDatabase = Pick<PrismaClient, "agentStop">;
type Row = Prisma.AgentStopGetPayload<object>;

/** The targets column, read and written through this one schema: the outcomes and both rounds. */
const targetsColumnSchema = z.object({
  outcomes: agentStopTargetOutcomeSchema.array(),
  restoreRound: agentStopRecordSchema.shape.restoreRound,
  retryRound: agentStopRecordSchema.shape.retryRound,
  retriedByUserId: agentStopRecordSchema.shape.retriedByUserId,
  retriedByApiKeyId: agentStopRecordSchema.shape.retriedByApiKeyId,
  lastRequestId: agentStopRecordSchema.shape.lastRequestId,
  advancedRequestIds: agentStopRecordSchema.shape.advancedRequestIds,
});
type TargetsColumn = z.infer<typeof targetsColumnSchema>;

function targetsColumnOf(stop: AgentStopRecord): Prisma.InputJsonValue {
  const column: TargetsColumn = {
    outcomes: stop.targets,
    restoreRound: stop.restoreRound,
    retryRound: stop.retryRound,
    retriedByUserId: stop.retriedByUserId,
    retriedByApiKeyId: stop.retriedByApiKeyId,
    lastRequestId: stop.lastRequestId,
    advancedRequestIds: stop.advancedRequestIds,
  };
  return targetsColumnSchema.parse(column) as Prisma.InputJsonValue;
}

function recordOf(row: Row): AgentStopRecord {
  const column = targetsColumnSchema.parse(row.targets);
  return agentStopRecordSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    agentName: row.agentName,
    status: row.status,
    severity: row.severity,
    approval: row.approval,
    trigger: row.trigger,
    reason: row.reason,
    requestedByUserId: row.requestedByUserId,
    requestedByApiKeyId: row.requestedByApiKeyId,
    decidedByUserId: row.decidedByUserId,
    decidedByApiKeyId: row.decidedByApiKeyId,
    restoredByUserId: row.restoredByUserId,
    restoredByApiKeyId: row.restoredByApiKeyId,
    targets: column.outcomes,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    quarantinedAt: row.quarantinedAt?.toISOString() ?? null,
    restoreRequestedAt: row.restoreRequestedAt?.toISOString() ?? null,
    restoredAt: row.restoredAt?.toISOString() ?? null,
    restoreRound: column.restoreRound,
    retryRound: column.retryRound,
    retriedByUserId: column.retriedByUserId,
    retriedByApiKeyId: column.retriedByApiKeyId,
    lastRequestId: column.lastRequestId,
    advancedRequestIds: column.advancedRequestIds,
  });
}

function columnsOf(stop: AgentStopRecord) {
  return {
    agentId: stop.agentId,
    agentName: stop.agentName,
    status: stop.status,
    severity: stop.severity,
    approval: stop.approval,
    trigger: stop.trigger,
    reason: stop.reason,
    requestedByUserId: stop.requestedByUserId,
    requestedByApiKeyId: stop.requestedByApiKeyId,
    decidedByUserId: stop.decidedByUserId,
    decidedByApiKeyId: stop.decidedByApiKeyId,
    restoredByUserId: stop.restoredByUserId,
    restoredByApiKeyId: stop.restoredByApiKeyId,
    targets: targetsColumnOf(stop),
    requestedAt: new Date(stop.requestedAt),
    decidedAt: stop.decidedAt ? new Date(stop.decidedAt) : null,
    quarantinedAt: stop.quarantinedAt ? new Date(stop.quarantinedAt) : null,
    restoreRequestedAt: stop.restoreRequestedAt ? new Date(stop.restoreRequestedAt) : null,
    restoredAt: stop.restoredAt ? new Date(stop.restoredAt) : null,
  };
}

export class PrismaAgentStopRepository extends AgentStopRepository {
  private constructor(private readonly prisma: AgentStopDatabase) {
    super();
  }

  static create(prisma: AgentStopDatabase): PrismaAgentStopRepository {
    return new PrismaAgentStopRepository(prisma);
  }

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<AgentStopProjectionState>> {
    const row = await this.prisma.agentStop.findFirst({
      where: { id: key, organizationId: String(context.tenantId) },
    });
    if (!row) return { kind: "empty" };
    return {
      kind: "folded",
      projection: {
        state: recordOf(row),
        cursor: { acceptedAt: Number(row.lastAcceptedAt), eventId: row.lastAppliedEventId },
        occurredAt: Number(row.lastOccurredAt),
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
        version: row.projectionVersion,
      },
    };
  }

  async store(
    projection: StoredProjection<AgentStopProjectionState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const stop = projection.state;
    if (!stop) return;
    const organizationId = String(context.tenantId);
    const data = {
      ...columnsOf(stop),
      lastAppliedEventId: projection.cursor.eventId,
      lastAcceptedAt: BigInt(projection.cursor.acceptedAt),
      lastOccurredAt: BigInt(projection.occurredAt),
      projectionVersion: projection.version,
      updatedAt: new Date(projection.updatedAt),
    };
    const existing = await this.prisma.agentStop.findFirst({
      where: { id: stop.id, organizationId },
      select: { id: true },
    });
    if (!existing) {
      const { count } = await this.prisma.agentStop.createMany({
        data: [{ ...data, id: stop.id, organizationId, createdAt: new Date(projection.createdAt) }],
        skipDuplicates: true,
      });
      if (count > 0) return;
    }
    // Updated in place, also when the request's seed row landed after the read above.
    await this.prisma.agentStop.updateMany({ where: { id: stop.id, organizationId }, data });
  }

  async seed({ stop, at }: { stop: AgentStopRecord; at: number }): Promise<void> {
    await this.prisma.agentStop.createMany({
      data: [
        {
          ...columnsOf(stop),
          id: stop.id,
          organizationId: stop.organizationId,
          lastAppliedEventId: "",
          lastAcceptedAt: 0n,
          lastOccurredAt: BigInt(at),
          projectionVersion: AGENT_STOP_PROJECTION_VERSION,
          createdAt: new Date(at),
          updatedAt: new Date(at),
        },
      ],
      skipDuplicates: true,
    });
  }

  async getStopWithCursor({
    organizationId,
    stopId,
  }: {
    organizationId: string;
    stopId: string;
  }): Promise<{ stop: AgentStopRecord; eventId: string }> {
    const row = await this.prisma.agentStop.findFirst({ where: { id: stopId, organizationId } });
    if (!row) throw new AgentStopNotFoundError(stopId);
    return { stop: recordOf(row), eventId: row.lastAppliedEventId };
  }

  async advance({ stop, eventId }: { stop: AgentStopRecord; eventId: string }): Promise<void> {
    await this.prisma.agentStop.updateMany({
      where: { id: stop.id, organizationId: stop.organizationId, lastAppliedEventId: eventId },
      data: columnsOf(stop),
    });
  }

  async getStop({
    organizationId,
    stopId,
  }: {
    organizationId: string;
    stopId: string;
  }): Promise<AgentStopRecord> {
    const row = await this.prisma.agentStop.findFirst({ where: { id: stopId, organizationId } });
    if (!row) throw new AgentStopNotFoundError(stopId);
    return recordOf(row);
  }

  async findByAgent({
    organizationId,
    agentId,
    limit,
  }: {
    organizationId: string;
    agentId: string;
    limit: number;
  }): Promise<AgentStopRecord[]> {
    const rows = await this.prisma.agentStop.findMany({
      where: { organizationId, agentId },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(recordOf);
  }

  async findByStatuses({
    organizationId,
    statuses,
    limit,
    before,
  }: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
    limit: number;
    before?: AgentStopPosition;
  }): Promise<AgentStopRecord[]> {
    const beforeAt = before ? new Date(before.requestedAt) : undefined;
    const rows = await this.prisma.agentStop.findMany({
      where: {
        organizationId,
        ...(statuses ? { status: { in: [...statuses] } } : {}),
        ...(before && beforeAt
          ? {
              OR: [
                { requestedAt: { lt: beforeAt } },
                { requestedAt: beforeAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(recordOf);
  }
}
