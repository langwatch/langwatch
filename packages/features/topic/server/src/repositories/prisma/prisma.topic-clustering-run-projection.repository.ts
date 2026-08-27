import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import type { Prisma } from "@langwatch/prisma-client/generated";
import type { TopicClusteringRunStatusData } from "../../projections/topic-clustering-run-status.projection";

/** KSUID resource for run-status projection rows (the app's KSUID_RESOURCES.TOPIC_CLUSTERING_RUN). */
const TOPIC_CLUSTERING_RUN_KSUID_RESOURCE = "topicrun";

type Row = Prisma.TopicClusteringRunProjectionGetPayload<object>;

type RunProjectionPrismaClient = {
  topicClusteringRunProjection: {
    findUnique(args: Prisma.TopicClusteringRunProjectionFindUniqueArgs): Promise<Row | null>;
    upsert(args: Prisma.TopicClusteringRunProjectionUpsertArgs): Promise<Row>;
  };
};

function fromRow(row: Row): StoredProjection<TopicClusteringRunStatusData> {
  const {
    id: _id,
    projectId,
    OccurredAt,
    AcceptedAt,
    LastEventId,
    ProjectionVersion,
    ...state
  } = row;
  return {
    state: { ...state, ProjectId: projectId, LastEventOccurredAt: OccurredAt },
    cursor: { acceptedAt: AcceptedAt, eventId: LastEventId },
    occurredAt: OccurredAt,
    createdAt: state.CreatedAt,
    updatedAt: state.UpdatedAt,
    version: ProjectionVersion,
  };
}

/** Postgres row I/O for the topic clustering run-status projection. */
export class PrismaTopicClusteringRunProjectionRepository
  implements StateProjectionStore<TopicClusteringRunStatusData>
{
  private constructor(private readonly prisma: RunProjectionPrismaClient) {}

  static create(options: {
    database: RunProjectionPrismaClient;
  }): PrismaTopicClusteringRunProjectionRepository {
    return new PrismaTopicClusteringRunProjectionRepository(options.database);
  }

  async tryLoad(
    _projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<TopicClusteringRunStatusData> | null> {
    const projectId = String(context.tenantId);
    const row = await this.prisma.topicClusteringRunProjection.findUnique({
      where: { projectId },
    });
    return row ? fromRow(row) : null;
  }

  async store(
    projection: StoredProjection<TopicClusteringRunStatusData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    // `state` legitimately carries CreatedAt/UpdatedAt (the fold base class
    // maintains them inside state), but the envelope's copies are the ones
    // being persisted — destructure state's out so the explicit assignment
    // below is the only source, not a spread-order accident.
    const {
      LastEventOccurredAt: _checkpoint,
      ProjectId: _projectId,
      CreatedAt: _stateCreatedAt,
      UpdatedAt: _stateUpdatedAt,
      ...state
    } = projection.state;
    const data = {
      ...state,
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    } satisfies Omit<Prisma.TopicClusteringRunProjectionUncheckedCreateInput, "id" | "projectId">;

    await this.prisma.topicClusteringRunProjection.upsert({
      where: { projectId },
      create: {
        id: generate(TOPIC_CLUSTERING_RUN_KSUID_RESOURCE).toString(),
        projectId,
        ...data,
      },
      update: data,
    });
  }
}
