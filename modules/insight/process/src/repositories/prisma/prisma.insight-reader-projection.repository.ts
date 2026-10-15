import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { InsightReaderState } from "../../eventing/insight-reader.projection.ts";
import { parseInsightReaderKey } from "../../rules/insight-reader-key.rules.ts";
import type { InsightReaderRow } from "./prisma.insight.mapper.ts";

function fromRow(row: InsightReaderRow): StoredProjection<InsightReaderState> {
  return {
    state: { seenAt: row.seenAt, archivedAt: row.archivedAt, keptAt: row.keptAt },
    cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.projectionVersion,
  };
}

/** Postgres row I/O for one reader's state on one insight, keyed `insightId:userId`. */
export class PrismaInsightReaderProjectionRepository
  extends PrismaRepository.for("InsightReaderProjection")
  implements StateProjectionStore<InsightReaderState>
{
  static readonly create = this.factory(
    (prisma) => new PrismaInsightReaderProjectionRepository(prisma),
  );

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightReaderState>> {
    const projectId = String(context.tenantId);
    const row = await this.prisma.insightReaderProjection.findFirst({
      where: { projectId, ...parseInsightReaderKey(key) },
    });
    return row ? { kind: "folded", projection: fromRow(row) } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<InsightReaderState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const { insightId, userId } = parseInsightReaderKey(context.key ?? context.aggregateId);
    const data = {
      ...projection.state,
      createdAt: projection.createdAt,
      updatedAt: projection.updatedAt,
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    };
    await this.prisma.insightReaderProjection.upsert({
      where: { projectId_insightId_userId: { projectId, insightId, userId }, projectId },
      create: {
        id: generate(KSUID_RESOURCES.INSIGHT_READER).toString(),
        projectId,
        insightId,
        userId,
        ...data,
      },
      update: data,
    });
  }
}
