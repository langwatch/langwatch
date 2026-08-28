import type { IngestionPullRunStatusData } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection";
import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import { buildIngestionSourceMirror } from "./ingestionSourceMirror";

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

export class PrismaIngestionPullRunProjectionRepository
  implements StateProjectionStore<IngestionPullRunStatusData>
{
  constructor(private readonly prisma: PrismaClient) {}

  async load(
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
    const {
      SourceId: _sourceId,
      LastEventOccurredAt: _checkpoint,
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
      const mirror = buildIngestionSourceMirror({ state: projection.state });
      await tx.ingestionSource.updateMany({
        // `IngestionSource` is organization-scoped and carries no projectId,
        // so the tenant predicate has to travel through the org that owns
        // this pipeline's governance project. Keyed on the source id alone,
        // a projection carrying another org's source id wrote that org's
        // cursor, error count and status.
        where: {
          id: sourceId,
          organization: {
            teams: { some: { projects: { some: { id: projectId } } } },
          },
        },
        data: {
          ...mirror,
          pollerCursor:
            mirror.pollerCursor === null
              ? Prisma.JsonNull
              : mirror.pollerCursor,
        },
      });
    });
  }
}
