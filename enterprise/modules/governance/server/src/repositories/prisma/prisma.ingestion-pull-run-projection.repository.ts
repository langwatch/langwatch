import type { AgentsListingSummary } from "../../services/agentsListingOutcome.ts";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import type { IngestionPullRunStatusData } from "../../projections/ingestion-pull-run-status-eventing.projection.ts";
import { buildIngestionSourceMirror } from "./ingestionSourceMirror.ts";

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

/**
 * Maps a row onto projection state by spreading whatever columns are left over
 * after the envelope is destructured, so a new column needs no edit here.
 *
 * The catch, and the reason this is written down: the spread is typed by the
 * GENERATED client, not by `schema.prisma`. Add a column to the schema and this
 * function stops compiling -- `state` is missing the new field -- which reads
 * exactly like a missing-fields bug in this file and is not one. The fix is to
 * regenerate (`pnpm run prisma:generate:typescript`) rather than to name the
 * new fields here. A hand-written state literal elsewhere, such as a test
 * fixture, genuinely does have to list them; this one does not.
 *
 * THE LIMIT OF THAT RULE. Regenerating is the whole fix only where the
 * generated column type is already the type the projection declares, which is
 * every column the spread currently carries. A column stored WIDER than the
 * interface -- a plain `String` in Postgres standing in for a union here -- is
 * not fixed by regenerating, because the generated type will faithfully say
 * `string` and the interface wants one of three words. That column needs an
 * explicit narrowing at this boundary, and a helper doing that narrowing is
 * load-bearing rather than redundant with the spread. Do not delete one on the
 * strength of the paragraph above.
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

  /**
   * The last agents listing for each of several sources, in one query.
   *
   * Beside {@link load} rather than expressed through it, and the reason is
   * cost rather than taste: `load` reads a whole projection row per call, and
   * the agents screen wants a two-column answer for every provider an
   * organization has connected. Looping `load` would fetch every run-status
   * column — cursor, error prose, both listing sets — once per source to
   * render one sentence.
   *
   * THE SELECT IS THE POINT. It names the two columns a customer-facing
   * decision reads and no others, so the status column never enters the
   * process that serves the page at all. That is the cheapest possible form of
   * the rule the privacy guard enforces by scanning names: a value that was
   * never selected cannot be forwarded by a later edit.
   *
   * `projectId` is the tenant predicate and is not optional. It is the
   * organization's hidden governance project — the same tenant the fold writes
   * under — and without it a source id from another organization would read
   * that organization's row.
   *
   * Sources with no row are absent from the map rather than present with a
   * null, because no row means no listing has ever been recorded for that
   * source, and `agentsListingOutcome` reads an absent row as exactly that.
   */
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
