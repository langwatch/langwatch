import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";

import type { InsightRunInFlightState } from "../../eventing/insight-run-in-flight.projection.ts";

export type InsightRunInFlightRow = Prisma.InsightRunInFlightProjectionGetPayload<object>;

export function runInFlightStateFromRow(row: InsightRunInFlightRow): InsightRunInFlightState {
  const { runId, conversationId, startedAt, lastSettledRunId } = row;
  return { runId, conversationId, startedAt, lastSettledRunId };
}

/** Postgres row I/O for a schedule's run in flight row; the row id is the schedule id. */
export class PrismaInsightRunInFlightProjectionRepository
  extends PrismaRepository.for("InsightRunInFlightProjection")
  implements StateProjectionStore<InsightRunInFlightState>
{
  static readonly create = this.factory(
    (prisma) => new PrismaInsightRunInFlightProjectionRepository(prisma),
  );

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightRunInFlightState>> {
    const row = await this.prisma.insightRunInFlightProjection.findFirst({
      where: { id: key, projectId: String(context.tenantId) },
    });
    if (!row) return { kind: "empty" };
    return {
      kind: "folded",
      projection: {
        state: runInFlightStateFromRow(row),
        cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
        occurredAt: row.occurredAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        version: row.projectionVersion,
      },
    };
  }

  async store(
    projection: StoredProjection<InsightRunInFlightState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.key ?? context.aggregateId;
    const projectId = String(context.tenantId);
    const data = {
      ...projection.state,
      createdAt: projection.createdAt,
      updatedAt: projection.updatedAt,
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    };
    await this.prisma.insightRunInFlightProjection.upsert({
      where: { id, projectId },
      create: { id, projectId, ...data },
      update: data,
    });
  }
}
