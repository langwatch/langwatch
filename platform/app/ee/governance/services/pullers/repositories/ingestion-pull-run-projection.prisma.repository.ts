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

/**
 * Maps a row onto projection state by spreading whatever columns are left over
 * after the envelope is destructured, so a new column needs no edit here.
 *
 * The catch, and the reason this is written down: the spread is typed by the
 * GENERATED client, not by `schema.prisma`. Add a column to the schema and this
 * function stops compiling -- `state` is missing the new field -- which reads
 * exactly like a missing-fields bug in this file and is not one. The fix is to
 * regenerate (`pnpm run prisma:generate:typescript`), never to name the new
 * fields here. A hand-written state literal elsewhere, such as a test fixture,
 * genuinely does have to list them; this one does not.
 */
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
