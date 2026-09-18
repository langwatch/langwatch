/**
 * The run's Postgres row: read for a caller, written by two writers.
 *
 * Two writers on one row, with a line between them that is the whole design:
 *
 *  - the SERVICE writes the definition once, when it accepts the run, so a
 *    caller can read the run back the instant they are handed its id rather
 *    than when a worker catches up;
 *  - the PROJECTION writes the counters and its own checkpoint, and never
 *    touches the definition, so a replay rebuilds what the run found without
 *    rewriting what it was asked.
 *
 * The projection's write is an `updateMany` rather than an `upsert`, which is
 * what makes a run somebody deleted stop rather than reappear: zero rows
 * updated is a no-op, not an insert.
 *
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection.ts
 */

import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { InstantEvalRunStatus } from "~/generated/prisma/client";
import type {
  InstantEvalRunProjectedStatus,
  InstantEvalRunProjectionState,
} from "~/server/event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection";
import { INITIAL_INSTANT_EVAL_RUN_STATE } from "~/server/event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";

type Row = Prisma.InstantEvalRunGetPayload<object>;

/** The definition a run is created with. Never written again. */
export interface InstantEvalRunDefinition {
  readonly id: string;
  readonly projectId: string;
  readonly name: string | null;
  readonly sql: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly questions: readonly unknown[];
  /** The query validator's hydration plan, read back once per page. */
  readonly plan: readonly unknown[];
  readonly rowLimit: number;
}

export interface InstantEvalRunListQuery {
  readonly projectId: string;
  readonly limit: number;
  /** Runs created strictly before this instant, which is the list's cursor. */
  readonly before?: Date;
}

export interface InstantEvalRunRepository {
  create(definition: InstantEvalRunDefinition): Promise<Row>;
  findById(input: { projectId: string; runId: string }): Promise<Row | null>;
  list(query: InstantEvalRunListQuery): Promise<Row[]>;
}

export class PrismaInstantEvalRunRepository
  implements InstantEvalRunRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(definition: InstantEvalRunDefinition): Promise<Row> {
    return await this.prisma.instantEvalRun.create({
      data: {
        id: definition.id,
        projectId: definition.projectId,
        name: definition.name,
        sql: definition.sql,
        parameters: definition.parameters as Prisma.InputJsonValue,
        questions: definition.questions as Prisma.InputJsonValue,
        plan: definition.plan as Prisma.InputJsonValue,
        rowLimit: definition.rowLimit,
        status: InstantEvalRunStatus.QUEUED,
      },
    });
  }

  async findById({
    projectId,
    runId,
  }: {
    projectId: string;
    runId: string;
  }): Promise<Row | null> {
    return await this.prisma.instantEvalRun.findFirst({
      where: { id: runId, projectId },
    });
  }

  async list({ projectId, limit, before }: InstantEvalRunListQuery) {
    return await this.prisma.instantEvalRun.findMany({
      where: { projectId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

/** The counters a row carries, read back as the projection's state. */
function stateFromRow(row: Row): InstantEvalRunProjectionState {
  return {
    status: row.status as InstantEvalRunProjectedStatus,
    total: row.total,
    progress: row.progress,
    matched: row.matched,
    matchedByQuestion: (row.matchedByQuestion ?? {}) as Record<string, number>,
    failed: row.failed,
    skipped: row.skipped,
    tokens: row.tokens,
    costUsd: row.costUsd,
    priceUsd: row.priceUsd,
    error: row.error,
    startedAtMs: row.startedAt?.getTime() ?? null,
    finishedAtMs: row.finishedAt?.getTime() ?? null,
  };
}

/**
 * The projection's half of the row.
 *
 * `load` answers null when the row has no checkpoint yet, which is the state
 * every accepted run starts in: the service wrote the definition and no event
 * has been folded, so the fold starts from `init()` rather than from counters
 * that were never applied to anything.
 */
export class PrismaInstantEvalRunProjectionStore
  implements StateProjectionStore<InstantEvalRunProjectionState>
{
  constructor(private readonly prisma: PrismaClient) {}

  async load(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<InstantEvalRunProjectionState> | null> {
    const projectId = String(context.tenantId);
    const row = await this.prisma.instantEvalRun.findFirst({
      where: { id: projectionKey, projectId },
    });
    if (!row || row.lastEventId === null || row.acceptedAt === null) {
      return null;
    }
    return {
      state: stateFromRow(row),
      cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
      occurredAt: row.occurredAt ?? row.createdAt.getTime(),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      version: row.projectionVersion ?? INITIAL_PROJECTION_VERSION,
    };
  }

  async store(
    projection: StoredProjection<InstantEvalRunProjectionState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const { state } = projection;
    await this.prisma.instantEvalRun.updateMany({
      // The run id rides with the project id, so a key from another tenant's
      // stream could never update this project's row.
      where: { id: context.key ?? context.aggregateId, projectId },
      data: {
        status: state.status as InstantEvalRunStatus,
        total: state.total,
        progress: state.progress,
        matched: state.matched,
        matchedByQuestion: state.matchedByQuestion as Prisma.InputJsonValue,
        failed: state.failed,
        skipped: state.skipped,
        tokens: state.tokens,
        costUsd: state.costUsd,
        priceUsd: state.priceUsd,
        error: state.error,
        startedAt:
          state.startedAtMs === null ? null : new Date(state.startedAtMs),
        finishedAt:
          state.finishedAtMs === null ? null : new Date(state.finishedAtMs),
        // The envelope's timestamps, not the clock: a replay has to reproduce
        // the same row rather than stamp it with whenever it was replayed.
        updatedAt: new Date(projection.updatedAt),
        occurredAt: projection.occurredAt,
        acceptedAt: projection.cursor.acceptedAt,
        lastEventId: projection.cursor.eventId,
        projectionVersion: projection.version,
      },
    });
  }
}

/** What a row with no recorded version is read as. */
const INITIAL_PROJECTION_VERSION = "2026-09-18";

export { INITIAL_INSTANT_EVAL_RUN_STATE, stateFromRow };
