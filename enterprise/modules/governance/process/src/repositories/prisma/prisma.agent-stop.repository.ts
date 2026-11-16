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

import type { AgentStopProjectionState } from "../../features/kill-switch/eventing/agent-stop.projection.ts";
import {
  type AgentStopRecord,
  agentStopRecordSchema,
} from "../../features/kill-switch/rules/agent-stop.rules.ts";
import { AgentStopRepository } from "../agent-stop.repository.ts";

type AgentStopDatabase = Pick<PrismaClient, "agentStop">;
type Row = Prisma.AgentStopGetPayload<object>;

/** The targets column holds the outcomes; `restoreRound` rides along beside them. */
const storedTargetsSchema = agentStopTargetOutcomeSchema.array();

function targetsColumnOf(stop: AgentStopRecord): Prisma.InputJsonValue {
  return { outcomes: stop.targets, restoreRound: stop.restoreRound } as Prisma.InputJsonValue;
}

function recordOf(row: Row): AgentStopRecord {
  const column = (row.targets ?? {}) as { outcomes?: unknown; restoreRound?: unknown };
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
    targets: storedTargetsSchema.parse(column.outcomes ?? []),
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    quarantinedAt: row.quarantinedAt?.toISOString() ?? null,
    restoreRequestedAt: row.restoreRequestedAt?.toISOString() ?? null,
    restoredAt: row.restoredAt?.toISOString() ?? null,
    restoreRound: typeof column.restoreRound === "number" ? column.restoreRound : 0,
  });
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
      targets: targetsColumnOf(stop),
      requestedAt: new Date(stop.requestedAt),
      decidedAt: stop.decidedAt ? new Date(stop.decidedAt) : null,
      quarantinedAt: stop.quarantinedAt ? new Date(stop.quarantinedAt) : null,
      restoreRequestedAt: stop.restoreRequestedAt ? new Date(stop.restoreRequestedAt) : null,
      restoredAt: stop.restoredAt ? new Date(stop.restoredAt) : null,
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
    if (existing) {
      await this.prisma.agentStop.updateMany({ where: { id: stop.id, organizationId }, data });
      return;
    }
    await this.prisma.agentStop.create({
      data: { ...data, id: stop.id, organizationId, createdAt: new Date(projection.createdAt) },
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
  }: {
    organizationId: string;
    statuses?: readonly AgentStopStatus[];
    limit: number;
  }): Promise<AgentStopRecord[]> {
    const rows = await this.prisma.agentStop.findMany({
      where: { organizationId, ...(statuses ? { status: { in: [...statuses] } } : {}) },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(recordOf);
  }
}
