import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";
import {
  dailyScheduleStateFromRow,
  type InsightDailyScheduleRow,
} from "./prisma.insight-daily-schedule.mapper.ts";

function fromRow(row: InsightDailyScheduleRow): StoredProjection<InsightDailyScheduleState> {
  return {
    state: dailyScheduleStateFromRow(row),
    cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.projectionVersion,
  };
}

/** Postgres row I/O for the daily run row; the row id is the schedule id. */
export class PrismaInsightDailyScheduleProjectionRepository
  extends PrismaRepository.for("InsightDailyScheduleProjection")
  implements StateProjectionStore<InsightDailyScheduleState>
{
  static readonly create = this.factory(
    (prisma) => new PrismaInsightDailyScheduleProjectionRepository(prisma),
  );

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightDailyScheduleState>> {
    const row = await this.prisma.insightDailyScheduleProjection.findFirst({
      where: { id: key, projectId: String(context.tenantId) },
    });
    return row ? { kind: "folded", projection: fromRow(row) } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<InsightDailyScheduleState>,
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
    await this.prisma.insightDailyScheduleProjection.upsert({
      where: { id, projectId },
      create: { id, projectId, ...data },
      update: data,
    });
  }
}
