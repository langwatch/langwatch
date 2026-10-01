import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

/** The two models and the transaction the topic-model swap runs inside. */
export type TopicModelProjectionDatabase = Pick<
  PrismaClient,
  "$transaction" | "topic" | "topicModelProjection"
>;
import type { ProjectedTopic, TopicModelData } from "../../eventing/topic-model.projection.ts";

// KSUID resource for topic-model projection cursor rows (KSUID_RESOURCES.TOPIC_MODEL_PROJECTION).
const TOPIC_MODEL_PROJECTION_KSUID_RESOURCE = "topicmodel";

/**
 * Write-through store for the topic model projection: cursor in
 * `TopicModelProjection`, model in `Topic` — the same rows/ids every topic
 * surface and ClickHouse reference, reconciled transactionally so replay converges.
 */
export class PrismaTopicModelProjectionRepository implements StateProjectionStore<TopicModelData> {
  private constructor(private readonly prisma: TopicModelProjectionDatabase) {}

  static create(options: {
    database: TopicModelProjectionDatabase;
  }): PrismaTopicModelProjectionRepository {
    return new PrismaTopicModelProjectionRepository(options.database);
  }

  async get(
    _projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<TopicModelData>> {
    const projectId = String(context.tenantId);
    const cursor = await this.prisma.topicModelProjection.findUnique({
      where: { projectId },
    });
    // No cursor row means the projection never ran for this project. Any
    // pre-existing Topic rows are pre-ownership data the seed event will
    // re-record; starting the fold from them would double-apply the seed.
    if (!cursor) return { kind: "empty" };

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
      recordedByEventId: row.lastEventId,
    }));

    return {
      kind: "folded",
      projection: {
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
      },
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
    } satisfies Omit<Prisma.TopicModelProjectionUncheckedCreateInput, "id" | "projectId">;

    // Parents before subtopics — LOAD-BEARING: relationMode = "prisma"
    // makes the client emulate the Topic self-relation (no DB FK), so a
    // child upserted before its parent exists is rejected.
    const ordered = [
      ...topics.filter((t) => t.parentId === null),
      ...topics.filter((t) => t.parentId !== null),
    ];

    await this.prisma.$transaction([
      this.prisma.topicModelProjection.upsert({
        where: { projectId },
        create: {
          id: generate(TOPIC_MODEL_PROJECTION_KSUID_RESOURCE).toString(),
          projectId,
          ...cursorData,
        },
        update: cursorData,
      }),
      // Fail-safe: never fold model to zero topics. Delete in two phases (children then parents)
      // to avoid relation violations that fail batch replace on every re-cluster.
      ...(keptIds.length > 0
        ? [
            this.prisma.topic.deleteMany({
              where: {
                projectId,
                parentId: { not: null },
                id: { notIn: keptIds },
              },
            }),
            this.prisma.topic.deleteMany({
              where: { projectId, id: { notIn: keptIds } },
            }),
          ]
        : []),
      ...ordered.map((topic) =>
        this.prisma.topic.upsert({
          // Topic ids are globally-unique nanoids minted by clustering or
          // carried from seed events; projectId rides along both to satisfy
          // the tenancy guard and so a forged cross-project id could never
          // update another tenant's row.
          where: { id: topic.id, projectId },
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
            lastEventId: topic.recordedByEventId,
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
            lastEventId: topic.recordedByEventId,
          },
        }),
      ),
    ]);
  }
}
