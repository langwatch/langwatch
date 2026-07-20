import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  ProjectedTopic,
  TopicModelData,
} from "~/server/event-sourcing/pipelines/topic-clustering-processing/projections/topicModel.foldProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Write-through store for the topic model projection: the cursor lives in
 * `TopicModelProjection` (one row per project), the model itself lives in
 * the `Topic` table — the SAME rows every topic surface reads, with the SAME
 * ids ClickHouse TopicId/SubTopicId references. Rows are reconciled
 * transactionally, so a replayed or redelivered event converges instead of
 * duplicating.
 */
export class PrismaTopicModelProjectionRepository
  implements StateProjectionStore<TopicModelData>
{
  constructor(private readonly prisma: PrismaClient) {}

  async load(
    _projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<TopicModelData> | null> {
    const projectId = String(context.tenantId);
    const cursor = await this.prisma.topicModelProjection.findUnique({
      where: { projectId },
    });
    // No cursor row means the projection never ran for this project. Any
    // pre-existing Topic rows are pre-ownership data the seed event will
    // re-record; starting the fold from them would double-apply the seed.
    if (!cursor) return null;

    const rows = await this.prisma.topic.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
    });
    const topics: ProjectedTopic[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      embeddingsModel: row.embeddings_model,
      centroid: row.centroid as number[],
      p95Distance: row.p95Distance,
      automaticallyGenerated: row.automaticallyGenerated,
      firstRecordedAt: row.createdAt.getTime(),
    }));

    return {
      state: {
        ProjectId: projectId,
        Topics: topics,
        CreatedAt: cursor.CreatedAt,
        UpdatedAt: cursor.UpdatedAt,
        LastEventOccurredAt: cursor.OccurredAt,
      },
      cursor: { acceptedAt: cursor.AcceptedAt, eventId: cursor.LastEventId },
      occurredAt: cursor.OccurredAt,
      createdAt: cursor.CreatedAt,
      updatedAt: cursor.UpdatedAt,
      version: cursor.ProjectionVersion,
    };
  }

  async store(
    projection: StoredProjection<TopicModelData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const topics = projection.state.Topics;
    const keptIds = topics.map((t) => t.id);
    const cursorData = {
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    } satisfies Omit<
      Prisma.TopicModelProjectionUncheckedCreateInput,
      "id" | "projectId"
    >;

    // Parents before subtopics, purely for readability of the write — the
    // Topic table carries no DB-level FK (see 0_init), so ordering is not
    // load-bearing.
    const ordered = [
      ...topics.filter((t) => t.parentId === null),
      ...topics.filter((t) => t.parentId !== null),
    ];

    await this.prisma.$transaction([
      this.prisma.topicModelProjection.upsert({
        where: { projectId },
        create: {
          id: generate(KSUID_RESOURCES.TOPIC_MODEL_PROJECTION).toString(),
          projectId,
          ...cursorData,
        },
        update: cursorData,
      }),
      this.prisma.topic.deleteMany({
        where: { projectId, id: { notIn: keptIds } },
      }),
      ...ordered.map((topic) =>
        this.prisma.topic.upsert({
          // Topic ids are globally-unique nanoids minted by clustering or
          // carried from seed events, and the reconcile delete above is
          // project-scoped — a cross-project id collision would take a
          // forged event to produce.
          where: { id: topic.id },
          create: {
            id: topic.id,
            projectId,
            name: topic.name,
            parentId: topic.parentId,
            embeddings_model: topic.embeddingsModel,
            centroid: topic.centroid,
            p95Distance: topic.p95Distance,
            automaticallyGenerated: topic.automaticallyGenerated,
            createdAt: new Date(topic.firstRecordedAt),
          },
          update: {
            projectId,
            name: topic.name,
            parentId: topic.parentId,
            embeddings_model: topic.embeddingsModel,
            centroid: topic.centroid,
            p95Distance: topic.p95Distance,
            automaticallyGenerated: topic.automaticallyGenerated,
            // The batch cadence gate reads the newest topic's age from
            // createdAt; keep it deterministic under replay.
            createdAt: new Date(topic.firstRecordedAt),
          },
        }),
      ),
    ]);
  }
}
