/**
 * The run row's two shapes, and the read that collapses versions: the merge
 * is eventual, so a lookup that did not collapse to the latest `WrittenAt`
 * could answer the definition after the counters were laid over it.
 */

import { type Instant, Temporal, toDate } from "@langwatch/time";

import {
  isInstantEvalStoredStatus,
  type InstantEvalStoredStatus,
} from "../../rules/instant-eval-run-status.rules.ts";
import type { InstantEvalRunRow } from "../instant-eval-run.repository.ts";

export const INSTANT_EVAL_RUNS_TABLE = "instant_eval_runs" as const;

/** The row as ClickHouse answers it, timestamps as epoch milliseconds. */
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
export interface InstantEvalRunWriteRecord {
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
 * the columns are reached through `t`, because the projection shadows their
 * names with epoch numbers) and for the inner max (where they are bare).
 */
export type InstantEvalRunNarrowing = (column: (name: string) => string) => string;

/**
 * The latest version of each run, by the IN-tuple pattern. `narrowings`
 * narrow both the outer read and the inner max, so a list page never dedups
 * rows it is about to discard.
 */
export function latestRowsQuery({
  narrowings,
}: {
  narrowings: readonly InstantEvalRunNarrowing[];
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
    FROM ${INSTANT_EVAL_RUNS_TABLE} AS t
    WHERE t.TenantId = {tenantId:String}
      ${outer}
      AND (t.TenantId, t.RunId, (t.WrittenAt, ifNull(t.AcceptedAt, toDateTime64(0, 3)), t.LastEventId)) IN (
        SELECT TenantId, RunId, max((WrittenAt, ifNull(AcceptedAt, toDateTime64(0, 3)), LastEventId))
        FROM ${INSTANT_EVAL_RUNS_TABLE}
        WHERE TenantId = {tenantId:String}
          ${inner}
        GROUP BY TenantId, RunId
      )
  `;
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
    createdAt: Temporal.Instant.fromEpochMilliseconds(Number(record.CreatedAt)),
    updatedAt: Temporal.Instant.fromEpochMilliseconds(Number(record.UpdatedAt)),
    startedAt: toInstant(record.StartedAt),
    finishedAt: toInstant(record.FinishedAt),
    occurredAt: toMillis(record.OccurredAt),
    acceptedAt: toMillis(record.AcceptedAt),
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
