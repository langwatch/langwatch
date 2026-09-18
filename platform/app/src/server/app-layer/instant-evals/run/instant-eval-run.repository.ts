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
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection.ts
 */

import { createLogger } from "@langwatch/observability";

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type {
  InstantEvalRunProjectedStatus,
  InstantEvalRunProjectionState,
} from "~/server/event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";

const TABLE_NAME = "instant_eval_runs" as const;

const logger = createLogger("langwatch:instant-evals:run-repository");

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

/** The row as ClickHouse answers it, timestamps as epoch milliseconds. */
interface RunRecord {
  TenantId: string;
  RunId: string;
  Name: string | null;
  Sql: string;
  Parameters: string;
  Questions: string;
  Plan: string;
  RowLimit: number;
  Status: string;
  Total: number | null;
  Progress: number;
  Matched: number | null;
  MatchedByQuestion: string;
  Failed: number;
  Skipped: number;
  Tokens: number | string;
  CostUsd: number;
  PriceUsd: number;
  Error: string | null;
  CreatedAt: number | string;
  UpdatedAt: number | string;
  StartedAt: number | string | null;
  FinishedAt: number | string | null;
  OccurredAt: number | string | null;
  AcceptedAt: number | string | null;
  LastEventId: string;
  ProjectionVersion: string;
}

/** The row as it is inserted: dates as dates, so the driver formats them. */
interface RunWriteRecord {
  TenantId: string;
  RunId: string;
  Name: string | null;
  Sql: string;
  Parameters: string;
  Questions: string;
  Plan: string;
  RowLimit: number;
  Status: string;
  Total: number | null;
  Progress: number;
  Matched: number | null;
  MatchedByQuestion: string;
  Failed: number;
  Skipped: number;
  Tokens: number;
  CostUsd: number;
  PriceUsd: number;
  Error: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  StartedAt: Date | null;
  FinishedAt: Date | null;
  OccurredAt: Date | null;
  AcceptedAt: Date | null;
  LastEventId: string;
  ProjectionVersion: string;
  WrittenAt: Date;
}

/**
 * A predicate on the table's own columns, spelled for the outer read (where
 * the columns are reached through the `t` alias, because the projection
 * shadows their names with epoch numbers) and for the inner max (where they
 * are bare).
 */
type Narrowing = (column: (name: string) => string) => string;

/**
 * The latest version of each run, by the IN-tuple pattern.
 *
 * `narrowings` narrow both the outer read and the inner max, so a list page
 * never dedups rows it is about to discard. Every timestamp is projected as
 * epoch milliseconds through the table alias, because the inner comparison
 * has to see the raw `WrittenAt` rather than a projected number.
 */
function latestRowsQuery({
  narrowings,
}: {
  narrowings: readonly Narrowing[];
}): string {
  const outer = narrowings
    .map((narrowing) => `AND ${narrowing((name) => `t.${name}`)}`)
    .join("\n      ");
  const inner = narrowings
    .map((narrowing) => `AND ${narrowing((name) => name)}`)
    .join("\n          ");
  return `
    SELECT
      t.TenantId AS TenantId,
      t.RunId AS RunId,
      t.Name AS Name,
      t.Sql AS Sql,
      t.Parameters AS Parameters,
      t.Questions AS Questions,
      t.Plan AS Plan,
      t.RowLimit AS RowLimit,
      t.Status AS Status,
      t.Total AS Total,
      t.Progress AS Progress,
      t.Matched AS Matched,
      t.MatchedByQuestion AS MatchedByQuestion,
      t.Failed AS Failed,
      t.Skipped AS Skipped,
      t.Tokens AS Tokens,
      t.CostUsd AS CostUsd,
      t.PriceUsd AS PriceUsd,
      t.Error AS Error,
      toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
      toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
      toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
      toUnixTimestamp64Milli(t.FinishedAt) AS FinishedAt,
      toUnixTimestamp64Milli(t.OccurredAt) AS OccurredAt,
      toUnixTimestamp64Milli(t.AcceptedAt) AS AcceptedAt,
      t.LastEventId AS LastEventId,
      t.ProjectionVersion AS ProjectionVersion
    FROM ${TABLE_NAME} AS t
    WHERE t.TenantId = {tenantId:String}
      ${outer}
      AND (t.TenantId, t.RunId, t.WrittenAt) IN (
        SELECT TenantId, RunId, max(WrittenAt)
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          ${inner}
        GROUP BY TenantId, RunId
      )
  `;
}

const ms = (value: number | string | null): number | null =>
  value === null ? null : Number(value);
const dateOf = (value: number | string | null): Date | null => {
  const at = ms(value);
  return at === null ? null : new Date(at);
};

function parseJson<T>(text: string, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

function toRow(record: RunRecord): InstantEvalRunRow {
  return {
    id: record.RunId,
    projectId: record.TenantId,
    name: record.Name,
    sql: record.Sql,
    parameters: parseJson<Record<string, unknown>>(record.Parameters, {}),
    questions: parseJson<unknown[]>(record.Questions, []),
    plan: parseJson<unknown[]>(record.Plan, []),
    rowLimit: Number(record.RowLimit),
    status: record.Status as InstantEvalRunProjectedStatus,
    total: ms(record.Total),
    progress: Number(record.Progress),
    matched: ms(record.Matched),
    matchedByQuestion: parseJson<Record<string, number>>(
      record.MatchedByQuestion,
      {},
    ),
    failed: Number(record.Failed),
    skipped: Number(record.Skipped),
    tokens: Number(record.Tokens),
    costUsd: Number(record.CostUsd),
    priceUsd: Number(record.PriceUsd),
    error: record.Error,
    createdAt: new Date(Number(record.CreatedAt)),
    updatedAt: new Date(Number(record.UpdatedAt)),
    startedAt: dateOf(record.StartedAt),
    finishedAt: dateOf(record.FinishedAt),
    occurredAt: ms(record.OccurredAt),
    acceptedAt: ms(record.AcceptedAt),
    lastEventId: record.LastEventId || null,
    projectionVersion: record.ProjectionVersion || null,
  };
}

/** A row as it is written back, whole. */
function toWriteRecord(
  row: InstantEvalRunRow,
  writtenAt: Date,
): RunWriteRecord {
  return {
    TenantId: row.projectId,
    RunId: row.id,
    Name: row.name,
    Sql: row.sql,
    Parameters: JSON.stringify(row.parameters),
    Questions: JSON.stringify(row.questions),
    Plan: JSON.stringify(row.plan),
    RowLimit: row.rowLimit,
    Status: row.status,
    Total: row.total,
    Progress: row.progress,
    Matched: row.matched,
    MatchedByQuestion: JSON.stringify(row.matchedByQuestion),
    Failed: row.failed,
    Skipped: row.skipped,
    Tokens: row.tokens,
    CostUsd: row.costUsd,
    PriceUsd: row.priceUsd,
    Error: row.error,
    CreatedAt: row.createdAt,
    UpdatedAt: row.updatedAt,
    StartedAt: row.startedAt,
    FinishedAt: row.finishedAt,
    OccurredAt: row.occurredAt === null ? null : new Date(row.occurredAt),
    AcceptedAt: row.acceptedAt === null ? null : new Date(row.acceptedAt),
    LastEventId: row.lastEventId ?? "",
    ProjectionVersion: row.projectionVersion ?? "",
    WrittenAt: writtenAt,
  };
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
    const [record] = await result.json<RunRecord>();
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
    const narrowings: Narrowing[] = [];
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
    return (await result.json<RunRecord>()).map(toRow);
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
      table: TABLE_NAME,
      values: [toWriteRecord(row, new Date(this.now()))],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}

/**
 * The projection's half of the row.
 *
 * `load` answers null when the row has no checkpoint yet, which is the state
 * every accepted run starts in: the service wrote the definition and no event
 * has been folded, so the fold starts from `init()` rather than from counters
 * that were never applied to anything.
 */
export class ClickHouseInstantEvalRunProjectionStore
  implements StateProjectionStore<InstantEvalRunProjectionState>
{
  constructor(private readonly runs: ClickHouseInstantEvalRunRepository) {}

  async load(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<InstantEvalRunProjectionState> | null> {
    const row = await this.runs.findById({
      projectId: String(context.tenantId),
      runId: projectionKey,
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
    const runId = context.key ?? context.aggregateId;
    // The run id rides with the project id, so a key from another tenant's
    // stream could never read, or overwrite, this project's row.
    const current = await this.runs.findById({ projectId, runId });
    if (!current) {
      logger.warn(
        { projectId, runId },
        "Instant Eval run row is gone; its counters are not written",
      );
      return;
    }
    const { state } = projection;
    await this.runs.write({
      ...current,
      status: state.status,
      total: state.total,
      progress: state.progress,
      matched: state.matched,
      matchedByQuestion: state.matchedByQuestion,
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
      // the same row rather than stamp it with whenever it was replayed. The
      // version column is the one exception, and the repository owns it.
      updatedAt: new Date(projection.updatedAt),
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    });
  }
}

/** The counters a row carries, read back as the projection's state. */
function stateFromRow(row: InstantEvalRunRow): InstantEvalRunProjectionState {
  return {
    status: row.status,
    total: row.total,
    progress: row.progress,
    matched: row.matched,
    matchedByQuestion: row.matchedByQuestion,
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

/** What a row with no recorded version is read as. */
const INITIAL_PROJECTION_VERSION = "2026-09-18";

export { stateFromRow };
