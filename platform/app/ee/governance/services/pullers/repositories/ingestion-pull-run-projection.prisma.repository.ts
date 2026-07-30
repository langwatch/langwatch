import {
  INGESTION_PULL_RUN_STATUS_VERSION,
  type IngestionPullRunStatusData,
  ingestionPullRunStatusSchema,
} from "@ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.projection";
import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@prisma/client";

type Row = Prisma.IngestionPullRunProjectionGetPayload<object>;

const INGESTION_PULL_RUN_KSUID_RESOURCE = "ingpullrun";

/**
 * Postgres is this fold's store: the run status is read back by the governance
 * UI and mirrored into `IngestionSource`, both relational. It owns the three
 * properties `clickhouseReplacing` centralises for the ClickHouse folds — the
 * version gate before decode, read-your-writes, and a durable-first write.
 */
function decode(row: Row): StateRead<IngestionPullRunStatusData> {
  // The version gate runs before any shape check: a row written under another
  // projection version must never reach checks only meaningful for the current
  // shape (`undecodable` is never `absent`).
  if (row.ProjectionVersion !== INGESTION_PULL_RUN_STATUS_VERSION) {
    return { kind: "undecodable", storedVersion: row.ProjectionVersion };
  }
  const parsed = ingestionPullRunStatusSchema.safeParse({
    ...row,
    SourceId: row.sourceId,
  });
  return parsed.success
    ? {
        kind: "found",
        stored: { state: parsed.data, version: row.ProjectionVersion },
      }
    : {
        kind: "undecodable",
        storedVersion: row.ProjectionVersion,
        cause: parsed.error,
      };
}

/** Mirrored onto the source itself so the pre-event-sourcing checkpoint, the
 * error count and the "has this source ever produced anything" status stay the
 * one answer the governance UI reads. */
function sourceMirror(state: IngestionPullRunStatusData) {
  const landedEvents =
    state.Enabled &&
    state.LastRunOutcome === "completed" &&
    state.LastRunEventCount > 0;
  return {
    pollerCursor: state.Cursor === null ? Prisma.JsonNull : state.Cursor,
    errorCount: state.ConsecutiveErrors,
    lastEventAt:
      landedEvents && state.LastRunAt !== null
        ? new Date(state.LastRunAt)
        : undefined,
    status: landedEvents ? "active" : undefined,
  };
}

export function createIngestionPullRunStatusStore(deps: {
  readonly prisma: PrismaClient;
}): ReplaceStore<IngestionPullRunStatusData> {
  return {
    kind: "replace",

    async read(
      key,
      context: StoreContext,
    ): Promise<StateRead<IngestionPullRunStatusData>> {
      const row = await deps.prisma.ingestionPullRunProjection.findUnique({
        // `sourceId` is the unique column; the tenant predicate stays explicit
        // so a row belonging to another governance project is never read.
        where: { sourceId: key, projectId: context.tenantId },
      });
      return row === null ? { kind: "absent" } : decode(row);
    },

    async write(
      key,
      stored: StoredState<IngestionPullRunStatusData>,
      context: StoreContext,
    ): Promise<void> {
      const projectId = context.tenantId;
      const now = Date.now();
      const { SourceId: _sourceId, ...state } = stored.state;
      const data = {
        ...state,
        UpdatedAt: now,
        // A `.withFold` handler sees no event id or accept time, so these
        // three columns are stamped from the write instead.
        OccurredAt: stored.state.LastRunAt ?? now,
        AcceptedAt: now,
        LastEventId: "",
        ProjectionVersion: stored.version,
      };

      await deps.prisma.$transaction(async (tx) => {
        await tx.ingestionPullRunProjection.upsert({
          where: { sourceId: key, projectId },
          // CreatedAt is stamped only on create, so first-write provenance
          // survives without a read before the write.
          create: {
            id: generate(INGESTION_PULL_RUN_KSUID_RESOURCE).toString(),
            sourceId: key,
            projectId,
            CreatedAt: now,
            ...data,
          },
          update: data,
        });
        await tx.ingestionSource.updateMany({
          where: { id: key },
          data: sourceMirror(stored.state),
        });
      });
    },
  };
}
