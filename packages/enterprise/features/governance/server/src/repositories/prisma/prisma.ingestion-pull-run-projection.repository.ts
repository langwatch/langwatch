import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import type { IngestionPullRunStatusData } from "../../projections/ingestion-pull-run-status-eventing.projection";

type Row = Prisma.IngestionPullRunProjectionGetPayload<object>;
const INGESTION_PULL_RUN_KSUID_RESOURCE = "ingpullrun";

function fromRow(row: Row): StoredProjection<IngestionPullRunStatusData> {
  const {
    id: _id,
    sourceId,
    projectId: _projectId,
    OccurredAt,
    AcceptedAt,
    LastEventId,
    ProjectionVersion,
    ...state
  } = row;
  return {
    state: { ...state, SourceId: sourceId, LastEventOccurredAt: OccurredAt },
    cursor: { acceptedAt: AcceptedAt, eventId: LastEventId },
    occurredAt: OccurredAt,
    createdAt: state.CreatedAt,
    updatedAt: state.UpdatedAt,
    version: ProjectionVersion,
  };
}

export class PrismaIngestionPullRunProjectionRepository implements StateProjectionStore<IngestionPullRunStatusData> {
  private constructor(private readonly prisma: PrismaClient) {}

  static create(database: object): PrismaIngestionPullRunProjectionRepository {
    return new PrismaIngestionPullRunProjectionRepository(database as PrismaClient);
  }

  async tryLoad(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<IngestionPullRunStatusData> | null> {
    const row = await this.prisma.ingestionPullRunProjection.findUnique({
      where: {
        sourceId: projectionKey,
        projectId: String(context.tenantId),
      },
    });
    return row ? fromRow(row) : null;
  }

  async store(
    projection: StoredProjection<IngestionPullRunStatusData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const sourceId = projection.state.SourceId;
    const projectId = String(context.tenantId);
    const { SourceId: _sourceId, LastEventOccurredAt: _checkpoint, ...state } = projection.state;
    const data = {
      ...state,
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.ingestionPullRunProjection.upsert({
        where: { sourceId, projectId },
        create: {
          id: generate(INGESTION_PULL_RUN_KSUID_RESOURCE).toString(),
          sourceId,
          projectId,
          ...data,
        },
        update: data,
      });
      await tx.ingestionSource.updateMany({
        where: { id: sourceId },
        data: {
          pollerCursor:
            projection.state.Cursor === null ? Prisma.JsonNull : projection.state.Cursor,
          errorCount: projection.state.ConsecutiveErrors,
          lastEventAt:
            projection.state.Enabled &&
            projection.state.LastRunOutcome === "completed" &&
            projection.state.LastRunEventCount > 0 &&
            projection.state.LastRunAt !== null
              ? new Date(projection.state.LastRunAt)
              : undefined,
          status:
            projection.state.Enabled &&
            projection.state.LastRunOutcome === "completed" &&
            projection.state.LastRunEventCount > 0
              ? "active"
              : undefined,
        },
      });
    });
  }
}
