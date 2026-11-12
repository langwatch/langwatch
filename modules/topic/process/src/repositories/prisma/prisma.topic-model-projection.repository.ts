import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import type { ProjectedTopic, TopicModelData } from "../../eventing/topic-model.projection.ts";

/** The two models, plus the raw SQL the bulk topic upsert needs. */
export type TopicModelProjectionDatabase = Pick<
  PrismaClient,
  "$executeRaw" | "topic" | "topicModelProjection"
>;

// KSUID resource for topic-model projection cursor rows (KSUID_RESOURCES.TOPIC_MODEL_PROJECTION).
const TOPIC_MODEL_PROJECTION_KSUID_RESOURCE = "topicmodel";

/** Rows per bulk upsert statement: a centroid vector rides on every row. */
const TOPIC_UPSERT_CHUNK_SIZE = 200;

/**
 * Write-through store for the topic model projection: cursor in
 * `TopicModelProjection`, model in `Topic`, the same rows and ids every topic
 * surface and ClickHouse reference. Idempotent steps, cursor last, so replay converges.
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
    // One INSERT ... ON CONFLICT cannot touch a row twice; the last entry wins, as it did per row.
    const topics = [...new Map(projection.state.Topics.map((t) => [t.id, t])).values()];
    const keptIds = topics.map((t) => t.id);
    const cursorData = {
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    } satisfies Omit<Prisma.TopicModelProjectionUncheckedCreateInput, "id" | "projectId">;

    // No transaction: a large model outran its timeout. Each step is idempotent
    // and the cursor moves last, so a failure anywhere replays the event.
    // Parents before subtopics: raw SQL skips the relationMode = "prisma" emulation.
    const ordered = [
      ...topics.filter((t) => t.parentId === null),
      ...topics.filter((t) => t.parentId !== null),
    ];
    const writtenAt = new Date();
    for (let start = 0; start < ordered.length; start += TOPIC_UPSERT_CHUNK_SIZE) {
      await this.upsertTopics({
        projectId,
        topics: ordered.slice(start, start + TOPIC_UPSERT_CHUNK_SIZE),
        writtenAt,
      });
    }

    // Fail-safe: never fold the model to zero topics. Children before parents,
    // so the emulated Restrict on the self-relation never refuses a parent.
    if (keptIds.length > 0) {
      await this.prisma.topic.deleteMany({
        where: { projectId, parentId: { not: null }, id: { notIn: keptIds } },
      });
      await this.prisma.topic.deleteMany({
        where: { projectId, id: { notIn: keptIds } },
      });
    }

    await this.prisma.topicModelProjection.upsert({
      where: { projectId },
      create: {
        id: generate(TOPIC_MODEL_PROJECTION_KSUID_RESOURCE).toString(),
        projectId,
        ...cursorData,
      },
      update: cursorData,
    });
  }

  /**
   * One statement per chunk. The update only lands on a row the project owns, so an
   * id another project owns is refused loudly and never overwrites that project's row.
   * createdAt is the recorded time: the batch cadence gate reads it under replay.
   */
  private async upsertTopics(input: {
    projectId: string;
    topics: ProjectedTopic[];
    writtenAt: Date;
  }): Promise<void> {
    const { projectId, topics, writtenAt } = input;
    if (topics.length === 0) return;
    const written = await this.prisma.$executeRaw`
      INSERT INTO "Topic" (
        "id", "projectId", "name", "parentId", "embeddings_model", "centroid",
        "p95Distance", "automaticallyGenerated", "createdAt", "updatedAt", "lastEventId"
      )
      SELECT
        incoming."id", ${projectId}, incoming."name", incoming."parentId", incoming."embeddingsModel",
        incoming."centroid"::jsonb, incoming."p95Distance", incoming."automaticallyGenerated",
        to_timestamp(incoming."createdAtMs" / 1000.0) AT TIME ZONE 'UTC', ${writtenAt}, incoming."lastEventId"
      FROM unnest(
        ${topics.map((t) => t.id)}::text[],
        ${topics.map((t) => t.name)}::text[],
        ${topics.map((t) => t.parentId)}::text[],
        ${topics.map((t) => t.embeddingsModel)}::text[],
        ${topics.map((t) => JSON.stringify(t.centroid))}::text[],
        ${topics.map((t) => t.p95Distance)}::double precision[],
        ${topics.map((t) => t.automaticallyGenerated)}::boolean[],
        ${topics.map((t) => t.firstRecordedAt)}::double precision[],
        ${topics.map((t) => t.recordedByEventId)}::text[]
      ) AS incoming(
        "id", "name", "parentId", "embeddingsModel", "centroid",
        "p95Distance", "automaticallyGenerated", "createdAtMs", "lastEventId"
      )
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "parentId" = EXCLUDED."parentId",
        "embeddings_model" = EXCLUDED."embeddings_model",
        "centroid" = EXCLUDED."centroid",
        "p95Distance" = EXCLUDED."p95Distance",
        "automaticallyGenerated" = EXCLUDED."automaticallyGenerated",
        "createdAt" = EXCLUDED."createdAt",
        "updatedAt" = EXCLUDED."updatedAt",
        "lastEventId" = EXCLUDED."lastEventId"
      WHERE "Topic"."projectId" = ${projectId}
    `;
    if (written !== topics.length) {
      throw new Error(
        `Stored ${written} of ${topics.length} topics: the rest have ids another project owns.`,
      );
    }
  }
}
