/**
 * The run row's two shapes, and the read that collapses versions: the merge
 * is eventual, so a lookup that did not collapse to the latest `WrittenAt`
 * could answer the definition after the counters were laid over it.
 */

import {
  clickhouseRead,
  type Condition,
  type ConditionOps,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { type Instant, Temporal, toDate } from "@langwatch/time";

import {
  isInstantEvalStoredStatus,
  type InstantEvalStoredStatus,
} from "../../rules/instant-eval-run-status.rules.ts";
import type { InstantEvalRunRow } from "../instant-eval-run.repository.ts";
import { instantEvalRuns as runs } from "./clickhouse.instant-eval-runs.table.ts";

export const INSTANT_EVAL_RUNS_TABLE = "instant_eval_runs" as const;

/** The row as ClickHouse answers it, timestamps as epoch milliseconds under `…Ms` keys. */
export interface InstantEvalRunRecord {
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
  CreatedAtMs: number | string;
  UpdatedAtMs: number | string;
  StartedAtMs: number | string | null;
  FinishedAtMs: number | string | null;
  OccurredAtMs: number | string | null;
  AcceptedAtMs: number | string | null;
  LastEventId: string;
  ProjectionVersion: string;
}

/** The row as it is inserted: dates as dates, so the driver formats them. */
interface InstantEvalRunWriteRecord {
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

/** What a latest-version read is narrowed by, applied to the election and to the read alike. */
export interface InstantEvalRunNarrowing {
  readonly runId?: string;
  /** Keyset paging on `(CreatedAt, RunId)`, epoch milliseconds. */
  readonly before?: { readonly atMs: number; readonly runId?: string };
}

/** The version a run's latest row wins by: written, then accepted, then the last event. */
const runVersion = () => fn.tuple(runs.WrittenAt, fn.ifNull(runs.AcceptedAt, 0), runs.LastEventId);

function narrowed<Ctes>(
  ops: ConditionOps<typeof INSTANT_EVAL_RUNS_TABLE, Ctes>,
  { runId, before }: InstantEvalRunNarrowing,
): Condition<typeof INSTANT_EVAL_RUNS_TABLE>[] {
  const { and, or, eq, lt } = ops;
  const terms: Condition<typeof INSTANT_EVAL_RUNS_TABLE>[] = [];
  if (runId !== undefined) terms.push(eq(runs.RunId, runId));
  // With `CreatedAt < before` alone a page that ended between two runs of the same millisecond
  // would skip the rest of them; the id breaks the tie, so the order is total.
  if (before?.runId !== undefined) {
    terms.push(
      or(
        lt(runs.CreatedAt, before.atMs),
        and(eq(runs.CreatedAt, before.atMs), lt(runs.RunId, before.runId)),
      ),
    );
  } else if (before !== undefined) {
    terms.push(lt(runs.CreatedAt, before.atMs));
  }
  return terms;
}

/**
 * The latest version of each run, by the IN-tuple pattern over `runVersion`; the narrowing
 * narrows the election and the read, so a list page never dedups rows it is about to discard.
 */
export function latestRunsRead({
  projectId,
  narrowing,
  limit,
  newestFirst = false,
}: {
  projectId: string;
  narrowing: InstantEvalRunNarrowing;
  limit?: number;
  /** Ordered by `(CreatedAt, RunId)` descending, the order a list pages in. */
  newestFirst?: boolean;
}): ReaderReadStatement<InstantEvalRunRecord> {
  const isNarrowed = narrowing.runId !== undefined || narrowing.before !== undefined;
  const read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(runs)
    .with("latest", (sub) => {
      const election = sub
        .from(runs)
        .select({ Elected: fn.tuple(runs.RunId, fn.max(runVersion())) })
        .groupBy(runs.RunId);
      return isNarrowed ? election.where((ops) => ops.and(...narrowed(ops, narrowing))) : election;
    })
    .select({
      TenantId: runs.TenantId,
      RunId: runs.RunId,
      Name: runs.Name,
      Sql: runs.Sql,
      Parameters: runs.Parameters,
      Questions: runs.Questions,
      Plan: runs.Plan,
      RowLimit: runs.RowLimit,
      Status: runs.Status,
      Total: runs.Total,
      Progress: runs.Progress,
      Matched: runs.Matched,
      MatchedByQuestion: runs.MatchedByQuestion,
      Failed: runs.Failed,
      Skipped: runs.Skipped,
      Tokens: runs.Tokens,
      CostUsd: runs.CostUsd,
      PriceUsd: runs.PriceUsd,
      Error: runs.Error,
      CreatedAtMs: fn.toUnixTimestamp64Milli(runs.CreatedAt),
      UpdatedAtMs: fn.toUnixTimestamp64Milli(runs.UpdatedAt),
      StartedAtMs: fn.toUnixTimestamp64Milli(runs.StartedAt),
      FinishedAtMs: fn.toUnixTimestamp64Milli(runs.FinishedAt),
      OccurredAtMs: fn.toUnixTimestamp64Milli(runs.OccurredAt),
      AcceptedAtMs: fn.toUnixTimestamp64Milli(runs.AcceptedAt),
      LastEventId: runs.LastEventId,
      ProjectionVersion: runs.ProjectionVersion,
    })
    .where((ops) =>
      ops.and(
        ...narrowed(ops, narrowing),
        ops.oneOf(fn.tuple(runs.RunId, runVersion()), { cte: "latest" }),
      ),
    );
  const ordered = newestFirst
    ? read.orderBy(runs.CreatedAt, "DESC").orderBy(runs.RunId, "DESC")
    : read;
  return (limit === undefined ? ordered : ordered.limit(limit)).build();
}

const toMillis = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

const toInstant = (value: number | string | null): Instant | null => {
  const at = toMillis(value);
  return at === null ? null : Temporal.Instant.fromEpochMilliseconds(at);
};

/** The driver takes dates, so a checkpoint's epoch millis become one here. */
const toEpochDate = (at: number | null): Date | null =>
  at === null ? null : toDate(Temporal.Instant.fromEpochMilliseconds(at));

function parseJson<T>(text: string, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The stored status, or QUEUED when the column carries something else. */
function statusOf(value: string): InstantEvalStoredStatus {
  return isInstantEvalStoredStatus(value) ? value : "QUEUED";
}

export function toRow(record: InstantEvalRunRecord): InstantEvalRunRow {
  return {
    id: record.RunId,
    projectId: record.TenantId,
    name: record.Name,
    sql: record.Sql,
    parameters: parseJson<Record<string, unknown>>(record.Parameters, {}),
    questions: parseJson<unknown[]>(record.Questions, []),
    plan: parseJson<unknown[]>(record.Plan, []),
    rowLimit: Number(record.RowLimit),
    status: statusOf(record.Status),
    total: toMillis(record.Total),
    progress: Number(record.Progress),
    matched: toMillis(record.Matched),
    matchedByQuestion: parseJson<Record<string, number>>(record.MatchedByQuestion, {}),
    failed: Number(record.Failed),
    skipped: Number(record.Skipped),
    tokens: Number(record.Tokens),
    costUsd: Number(record.CostUsd),
    priceUsd: Number(record.PriceUsd),
    error: record.Error,
    createdAt: Temporal.Instant.fromEpochMilliseconds(Number(record.CreatedAtMs)),
    updatedAt: Temporal.Instant.fromEpochMilliseconds(Number(record.UpdatedAtMs)),
    startedAt: toInstant(record.StartedAtMs),
    finishedAt: toInstant(record.FinishedAtMs),
    occurredAt: toMillis(record.OccurredAtMs),
    acceptedAt: toMillis(record.AcceptedAtMs),
    lastEventId: record.LastEventId || null,
    projectionVersion: record.ProjectionVersion || null,
  };
}

/** A row as it is written back, whole. */
export function toWriteRecord({
  row,
  writtenAt,
}: {
  row: InstantEvalRunRow;
  writtenAt: Instant;
}): InstantEvalRunWriteRecord {
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
    CreatedAt: toDate(row.createdAt),
    UpdatedAt: toDate(row.updatedAt),
    StartedAt: row.startedAt === null ? null : toDate(row.startedAt),
    FinishedAt: row.finishedAt === null ? null : toDate(row.finishedAt),
    OccurredAt: toEpochDate(row.occurredAt),
    AcceptedAt: toEpochDate(row.acceptedAt),
    LastEventId: row.lastEventId ?? "",
    ProjectionVersion: row.projectionVersion ?? "",
    WrittenAt: toDate(writtenAt),
  };
}
