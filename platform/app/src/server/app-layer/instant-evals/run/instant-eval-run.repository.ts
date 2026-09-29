/**
 * The run's ClickHouse row: read for a caller, written by two writers.
 *
 * Two writers on one row, with a line between them that is the whole design:
 *
 *  - the SERVICE writes the definition once, when it accepts the run, so a
 *    caller can read the run back the instant they are handed its id rather
 *    than when a worker catches up;
 *  - the PROJECTION writes the counters and its own checkpoint, carrying the
 *    definition forward unchanged, so a replay rebuilds what the run found
 *    without rewriting what it was asked.
 *
 * The table is a ReplacingMergeTree keyed by the tenant and the run, so every
 * write is a whole row and the latest version wins. That is what makes the
 * projection's write a read-then-insert rather than an update: it reads the
 * definition the service wrote, lays the counters over it, and inserts. A run
 * somebody deleted has no row to read, so the write is a no-op and the run
 * stops rather than reappearing.
 *
 * The version column is `WrittenAt`, the writer's clock at the insert, and not
 * the business `UpdatedAt`: the run's first event is recorded before the
 * service's row lands, so a projection write versioned by business time would
 * lose the merge to the definition. Every read collapses to the latest
 * `WrittenAt` through the IN-tuple pattern, because the merge is eventual.
 *
 * @see ../../../clickhouse/migrations/00098_create_instant_eval_runs.sql
 * @see ./instant-eval-run.rows.ts
 * @see ./instant-eval-run.projection-store.ts
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { InstantEvalRunProjectedStatus } from "~/server/event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection";
import {
  INSTANT_EVAL_RUNS_TABLE,
  type InstantEvalRunNarrowing,
  type InstantEvalRunRecord,
  latestRowsQuery,
  toRow,
  toWriteRecord,
} from "./instant-eval-run.rows";

/** One run as the application reads it: the definition and the counters. */
export interface InstantEvalRunRow {
  readonly id: string;
  readonly projectId: string;
  readonly name: string | null;
  /** The statement, exactly as submitted. */
  readonly sql: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly questions: readonly unknown[];
  /** The query validator's hydration plan, read back once per page. */
  readonly plan: readonly unknown[];
  readonly rowLimit: number;
  readonly status: InstantEvalRunProjectedStatus;
  readonly total: number | null;
  readonly progress: number;
  readonly matched: number | null;
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  readonly failed: number;
  readonly skipped: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly priceUsd: number;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  /** The projection's checkpoint, null until the first event is folded. */
  readonly occurredAt: number | null;
  readonly acceptedAt: number | null;
  readonly lastEventId: string | null;
  readonly projectionVersion: string | null;
}

/** The definition a run is created with. Never written again. */
export interface InstantEvalRunDefinition {
  readonly id: string;
  readonly projectId: string;
  readonly name: string | null;
  readonly sql: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly questions: readonly unknown[];
  readonly plan: readonly unknown[];
  readonly rowLimit: number;
}

export interface InstantEvalRunListQuery {
  readonly projectId: string;
  readonly limit: number;
  /** Runs created strictly before this instant, the first half of the cursor. */
  readonly before?: Date;
  /**
   * The id the previous page ended on, the second half.
   *
   * Two runs can share a `createdAt`, so the instant alone is not a total
   * order: a page ending between them would skip every other run written in
   * the same millisecond.
   */
  readonly beforeId?: string;
}

export interface InstantEvalRunRepository {
  create(definition: InstantEvalRunDefinition): Promise<InstantEvalRunRow>;
  findById(input: {
    projectId: string;
    runId: string;
  }): Promise<InstantEvalRunRow | null>;
  list(query: InstantEvalRunListQuery): Promise<InstantEvalRunRow[]>;
  /**
   * Fails a run whose start was never dispatched.
   *
   * The only write on this side that is not the projection's: every other
   * status change is folded from an event, and this one has no event to fold
   * because the command that would have produced it is what failed. Scoped to
   * a run still queued so it can never overtake a run that did start.
   */
  fail(input: {
    projectId: string;
    runId: string;
    code: string;
  }): Promise<void>;
}

export interface ClickHouseInstantEvalRunRepositoryOptions {
  readonly resolveClient: ClickHouseClientResolver;
  /** Injected so a suite can pin the write clock. */
  readonly now?: () => number;
}

export class ClickHouseInstantEvalRunRepository
  implements InstantEvalRunRepository
{
  private readonly resolveClient: ClickHouseClientResolver;
  private readonly now: () => number;

  constructor(options: ClickHouseInstantEvalRunRepositoryOptions) {
    this.resolveClient = options.resolveClient;
    this.now = options.now ?? (() => Date.now());
  }

  async create(
    definition: InstantEvalRunDefinition,
  ): Promise<InstantEvalRunRow> {
    const at = new Date(this.now());
    const row: InstantEvalRunRow = {
      ...definition,
      status: "QUEUED",
      total: null,
      progress: 0,
      matched: null,
      matchedByQuestion: {},
      failed: 0,
      skipped: 0,
      tokens: 0,
      costUsd: 0,
      priceUsd: 0,
      error: null,
      createdAt: at,
      updatedAt: at,
      startedAt: null,
      finishedAt: null,
      occurredAt: null,
      acceptedAt: null,
      lastEventId: null,
      projectionVersion: null,
    };
    await this.write(row);
    return row;
  }

  async findById({
    projectId,
    runId,
  }: {
    projectId: string;
    runId: string;
  }): Promise<InstantEvalRunRow | null> {
    const client = await this.resolveClient(projectId);
    const result = await client.query({
      query: `${latestRowsQuery({
        narrowings: [(column) => `${column("RunId")} = {runId:String}`],
      })} LIMIT 1`,
      query_params: { tenantId: projectId, runId },
      format: "JSONEachRow",
    });
    const [record] = await result.json<InstantEvalRunRecord>();
    return record ? toRow(record) : null;
  }

  async list({
    projectId,
    limit,
    before,
    beforeId,
  }: InstantEvalRunListQuery): Promise<InstantEvalRunRow[]> {
    // Ordered and paged by the pair, because two runs can share a createdAt:
    // a page that ended between them would, with `createdAt < before` alone,
    // skip every other run written in that same millisecond. The id breaks
    // the tie and is unique, so the order is total.
    const narrowings: InstantEvalRunNarrowing[] = [];
    if (before && beforeId) {
      narrowings.push(
        (column) =>
          `(${column("CreatedAt")} < {before:DateTime64(3)} OR (${column("CreatedAt")} = {before:DateTime64(3)} AND ${column("RunId")} < {beforeId:String}))`,
      );
    } else if (before) {
      narrowings.push(
        (column) => `${column("CreatedAt")} < {before:DateTime64(3)}`,
      );
    }
    const client = await this.resolveClient(projectId);
    const result = await client.query({
      query: `
        ${latestRowsQuery({ narrowings })}
        ORDER BY t.CreatedAt DESC, t.RunId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: projectId,
        limit,
        ...(before ? { before } : {}),
        ...(beforeId ? { beforeId } : {}),
      },
      format: "JSONEachRow",
    });
    return (await result.json<InstantEvalRunRecord>()).map(toRow);
  }

  async fail({
    projectId,
    runId,
    code,
  }: {
    projectId: string;
    runId: string;
    code: string;
  }): Promise<void> {
    const row = await this.findById({ projectId, runId });
    if (row?.status !== "QUEUED") return;
    const at = new Date(this.now());
    await this.write({
      ...row,
      status: "FAILED",
      error: code,
      updatedAt: at,
      finishedAt: at,
    });
  }

  /** One whole row, versioned by this writer's clock. */
  async write(row: InstantEvalRunRow): Promise<void> {
    const client = await this.resolveClient(row.projectId);
    await client.insert({
      table: INSTANT_EVAL_RUNS_TABLE,
      values: [toWriteRecord({ row, writtenAt: new Date(this.now()) })],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}
