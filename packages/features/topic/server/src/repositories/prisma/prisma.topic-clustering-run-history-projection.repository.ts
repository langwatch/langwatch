import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { z } from "zod";
import {
  topicClusteringRunHistoryProjectionEntrySchema,
  type TopicClusteringRunHistoryData,
  type TopicClusteringRunHistoryEntry,
} from "../../projections/topic-clustering-run-history.projection";

/** KSUID resource for run-history projection rows (the app's KSUID_RESOURCES.TOPIC_CLUSTERING_RUN_HISTORY). */
const TOPIC_CLUSTERING_RUN_HISTORY_KSUID_RESOURCE = "topicrunhist";

type Row = Prisma.TopicClusteringRunHistoryProjectionGetPayload<object>;

type RunHistoryPrismaClient = {
  topicClusteringRunHistoryProjection: {
    findUnique(args: Prisma.TopicClusteringRunHistoryProjectionFindUniqueArgs): Promise<Row | null>;
    upsert(args: Prisma.TopicClusteringRunHistoryProjectionUpsertArgs): Promise<Row>;
  };
};

// The persisted shape of one history entry is the fold projection's own
// schema (single source of truth; the type is z.infer'd from it there).
// Validated on read so a corrupted or hand-edited JSON column degrades to
// an empty history (which a replay rebuilds) instead of poisoning the fold.
const runsSchema = z.array(topicClusteringRunHistoryProjectionEntrySchema);

export function parseRunHistoryRuns(value: unknown): TopicClusteringRunHistoryEntry[] {
  const parsed = runsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function fromRow(row: Row): StoredProjection<TopicClusteringRunHistoryData> {
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

/** Postgres row I/O for the topic clustering run-history projection. */
export class PrismaTopicClusteringRunHistoryProjectionRepository implements StateProjectionStore<TopicClusteringRunHistoryData> {
  private constructor(private readonly prisma: RunHistoryPrismaClient) {}

  static create(options: {
    database: RunHistoryPrismaClient;
  }): PrismaTopicClusteringRunHistoryProjectionRepository {
    return new PrismaTopicClusteringRunHistoryProjectionRepository(options.database);
  }

  async tryLoad(
    _projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<TopicClusteringRunHistoryData> | null> {
    const projectId = String(context.tenantId);
    const row = await this.prisma.topicClusteringRunHistoryProjection.findUnique({
      where: { projectId },
    });
    return row ? fromRow(row) : null;
  }

  async store(
    projection: StoredProjection<TopicClusteringRunHistoryData>,
    context: ProjectionStoreContext,
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
        id: generate(TOPIC_CLUSTERING_RUN_HISTORY_KSUID_RESOURCE).toString(),
        projectId,
        ...data,
      },
      update: data,
    });
  }
}
