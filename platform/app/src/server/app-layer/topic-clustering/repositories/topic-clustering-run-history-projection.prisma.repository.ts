import { generate } from "@langwatch/ksuid";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import type {
  LegacyProjectionStoreContext,
  LegacyStateProjectionStore,
  LegacyStoredProjection,
} from "~/server/app-layer/_shared/legacyProjectionStore.types";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  type TopicClusteringRunHistoryData,
  type TopicClusteringRunHistoryEntry,
  topicClusteringRunHistoryEntrySchema,
} from "./topicClusteringRunHistory.schema";

type Row = Prisma.TopicClusteringRunHistoryProjectionGetPayload<object>;

type RunHistoryPrismaClient = {
  topicClusteringRunHistoryProjection: {
    findUnique(
      args: Prisma.TopicClusteringRunHistoryProjectionFindUniqueArgs,
    ): Promise<Row | null>;
    upsert(
      args: Prisma.TopicClusteringRunHistoryProjectionUpsertArgs,
    ): Promise<Row>;
  };
};

// The persisted shape of one history entry is the fold projection's own
// schema (single source of truth; the type is z.infer'd from it there).
// Validated on read so a corrupted or hand-edited JSON column degrades to
// an empty history (which a replay rebuilds) instead of poisoning the fold.
const runsSchema = z.array(topicClusteringRunHistoryEntrySchema);

export function parseRunHistoryRuns(
  value: unknown,
): TopicClusteringRunHistoryEntry[] {
  const parsed = runsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function fromRow(
  row: Row,
): LegacyStoredProjection<TopicClusteringRunHistoryData> {
  return {
    state: {
      ProjectId: row.projectId,
      Runs: parseRunHistoryRuns(row.Runs),
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      LastEventOccurredAt: row.OccurredAt,
    },
    cursor: { acceptedAt: row.AcceptedAt, eventId: row.LastEventId },
    occurredAt: row.OccurredAt,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    version: row.ProjectionVersion,
  };
}

/**
 * Postgres row I/O for the topic clustering run-history projection.
 *
 * The pipeline's own `topicClusteringRunHistory` fold now writes to
 * ClickHouse (`clickhouseReplacing`, see
 * `event-sourcing/topic-clustering-processing`), so this class is no longer
 * that fold's store and does not implement any engine contract — it keeps
 * its own local load/store shape unchanged, serving whatever app-layer read
 * still goes through it.
 */
export class PrismaTopicClusteringRunHistoryProjectionRepository
  implements LegacyStateProjectionStore<TopicClusteringRunHistoryData>
{
  constructor(private readonly prisma: RunHistoryPrismaClient) {}

  async load(
    _projectionKey: string,
    context: LegacyProjectionStoreContext,
  ): Promise<LegacyStoredProjection<TopicClusteringRunHistoryData> | null> {
    const projectId = String(context.tenantId);
    const row =
      await this.prisma.topicClusteringRunHistoryProjection.findUnique({
        where: { projectId },
      });
    return row ? fromRow(row) : null;
  }

  async store(
    projection: LegacyStoredProjection<TopicClusteringRunHistoryData>,
    context: LegacyProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const data = {
      Runs: projection.state.Runs as unknown as Prisma.InputJsonValue,
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    } satisfies Omit<
      Prisma.TopicClusteringRunHistoryProjectionUncheckedCreateInput,
      "id" | "projectId"
    >;

    await this.prisma.topicClusteringRunHistoryProjection.upsert({
      where: { projectId },
      create: {
        id: generate(KSUID_RESOURCES.TOPIC_CLUSTERING_RUN_HISTORY).toString(),
        projectId,
        ...data,
      },
      update: data,
    });
  }
}
