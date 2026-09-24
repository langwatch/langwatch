import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type { IngestionPullRunStatusData } from "../../eventing/ingestion-pull-run-status-eventing.projection.ts";
import type { AgentsListingSummary } from "../../services/agents-listing-outcome.service.ts";
import { buildIngestionSourceMirror } from "./prisma.ingestion-source-mirror.mapper.ts";

type Row = Prisma.IngestionPullRunProjectionGetPayload<object>;
const INGESTION_PULL_RUN_KSUID_RESOURCE = "ingpullrun";

/**
 * The column is a plain string so that the log outlives the vocabulary: a row
 * carrying a word this build has never heard of reads as unknown rather than
 * being forced into one of the two it does know.
 */
function completenessOf(stored: string | null): IngestionPullRunStatusData["LastRunCompleteness"] {
  return stored === "complete" || stored === "truncated" ? stored : null;
}

// Spread auto-adapts to new schema columns via generated types; explicit narrowing
// needed for columns stored wider than interface.
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
    state: {
      ...state,
      LastRunCompleteness: completenessOf(state.LastRunCompleteness),
      SourceId: sourceId,
      LastEventOccurredAt: OccurredAt,
    },
    cursor: { acceptedAt: AcceptedAt, eventId: LastEventId },
    occurredAt: OccurredAt,
    createdAt: state.CreatedAt,
    updatedAt: state.UpdatedAt,
    version: ProjectionVersion,
  };
}

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type IngestionPullRunProjectionDatabase = Pick<
  PrismaClient,
  "ingestionPullRunProjection" | "ingestionSource" | "$transaction"
>;

export class PrismaIngestionPullRunProjectionRepository implements StateProjectionStore<IngestionPullRunStatusData> {
  private constructor(private readonly prisma: IngestionPullRunProjectionDatabase) {}

  static create(
    database: IngestionPullRunProjectionDatabase,
  ): PrismaIngestionPullRunProjectionRepository {
    return new PrismaIngestionPullRunProjectionRepository(database);
  }

  async get(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<IngestionPullRunStatusData>> {
    const row = await this.prisma.ingestionPullRunProjection.findUnique({
      where: {
        sourceId: projectionKey,
        projectId: String(context.tenantId),
      },
    });
    return row ? { kind: "folded", projection: fromRow(row) } : { kind: "empty" };
  }

  // Separate from load for cost: agents screen needs two columns per source.
  // SELECT enforces privacy: unselected values cannot leak; projectId prevents cross-org reads.
  async findAgentsListings({
    sourceIds,
    projectId,
  }: {
    sourceIds: readonly string[];
    projectId: string;
  }): Promise<Map<string, AgentsListingSummary>> {
    if (sourceIds.length === 0) return new Map();
    const rows = await this.prisma.ingestionPullRunProjection.findMany({
      where: { sourceId: { in: [...sourceIds] }, projectId },
      select: {
        sourceId: true,
        LastAgentsListingOutcome: true,
        LastAgentsListingReason: true,
      },
    });
    return new Map(
      rows.map((row): [string, AgentsListingSummary] => [
        row.sourceId,
        {
          LastAgentsListingOutcome: row.LastAgentsListingOutcome,
          LastAgentsListingReason: row.LastAgentsListingReason,
        },
      ]),
    );
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
          pollerCursor: mirror.pollerCursor === null ? Prisma.JsonNull : mirror.pollerCursor,
        },
      });
    });
  }
}
