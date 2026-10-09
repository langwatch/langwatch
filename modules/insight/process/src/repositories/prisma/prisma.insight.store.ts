import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { InsightState } from "../../eventing/insight.projection.ts";
import { type InsightRow, insightEntryFromRows } from "./prisma.insight.mapper.ts";

/** The shared record is the inbox entry without a reader, so the read mapper serves both. */
function fromRow(row: InsightRow): StoredProjection<InsightState> {
  const {
    id: _id,
    seenAt: _seenAt,
    archivedAt: _archivedAt,
    keptAt: _keptAt,
    ...state
  } = insightEntryFromRows({ insight: row, reader: undefined });
  return {
    state,
    cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.projectionVersion,
  };
}

/** Postgres row I/O for the insight projection; the row id is the insight id. */
export class PrismaInsightProjectionStore
  extends PrismaRepository.for("InsightProjection")
  implements StateProjectionStore<InsightState>
{
  static readonly create = this.factory((prisma) => new PrismaInsightProjectionStore(prisma));

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightState>> {
    const row = await this.prisma.insightProjection.findFirst({
      where: { id: key, projectId: String(context.tenantId) },
    });
    return row ? { kind: "folded", projection: fromRow(row) } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<InsightState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.key ?? context.aggregateId;
    const projectId = String(context.tenantId);
    const { source, ...state } = projection.state;
    const data = {
      ...state,
      sourceConversationId: source?.conversationId ?? null,
      sourceMessageId: source?.messageId ?? null,
      createdAt: projection.createdAt,
      updatedAt: projection.updatedAt,
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    };
    await this.prisma.insightProjection.upsert({
      where: { id, projectId },
      create: { id, projectId, ...data },
      update: data,
    });
  }
}
