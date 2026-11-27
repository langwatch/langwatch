import type { InstantEvalDailyRunCount } from "@langwatch/instant-eval-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import type {
  InstantEvalRunDefinition,
  InstantEvalRunListQuery,
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../instant-eval-run.repository.ts";
import {
  INSTANT_EVAL_RUNS_TABLE,
  type InstantEvalRunNarrowing,
  type InstantEvalRunRecord,
  latestRowsQuery,
  toRow,
  toWriteRecord,
} from "./clickhouse.instant-eval-run.mapper.ts";
import type { InstantEvalClickHouseResolver } from "./clickhouse.instant-eval-session.store.ts";

const usageRowsSchema = z.array(z.object({ Total: z.string(), FirstMs: z.string() }));
const dailyRowsSchema = z.array(
  z.object({
    DayMs: z.string(),
    Status: z.string(),
    ErrorCode: z.string(),
    Runs: z.string(),
    Judged: z.string(),
    Largest: z.string(),
    PriceUsd: z.string(),
    LastMs: z.string(),
  }),
);

export class ClickHouseInstantEvalRunRepository implements InstantEvalRunRepository {
  private constructor(
    private readonly resolveClient: InstantEvalClickHouseResolver,
    private readonly now: () => Instant,
  ) {}

  static create({
    resolveClient,
    now = nowInstant,
  }: {
    resolveClient: InstantEvalClickHouseResolver;
    /** Injected so a suite can pin the write clock. */
    now?: () => Instant;
  }): ClickHouseInstantEvalRunRepository {
    return new ClickHouseInstantEvalRunRepository(resolveClient, now);
  }

  async create(definition: InstantEvalRunDefinition): Promise<InstantEvalRunRow> {
    const at = this.now();
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
    const result = await client.query<InstantEvalRunRecord>({
      query: `${latestRowsQuery({
        narrowings: [(column) => `${column("RunId")} = {runId:String}`],
      })} LIMIT 1`,
      query_params: { tenantId: projectId, runId },
      format: "JSONEachRow",
    });
    const [record] = await result.json();
    return record ? toRow(record) : null;
  }

  async findPage({
    projectId,
    limit,
    before,
    beforeId,
  }: InstantEvalRunListQuery): Promise<InstantEvalRunRow[]> {
    // Ordered and paged by the pair: with `createdAt < before` alone a page
    // that ended between two runs of the same millisecond would skip the rest
    // of them. The id breaks the tie, so the order is total.
    const narrowings: InstantEvalRunNarrowing[] = [];
    if (before && beforeId) {
      narrowings.push(
        (column) =>
          `(${column("CreatedAt")} < {before:DateTime64(3)} OR (${column("CreatedAt")} = {before:DateTime64(3)} AND ${column("RunId")} < {beforeId:String}))`,
      );
    } else if (before) {
      narrowings.push((column) => `${column("CreatedAt")} < {before:DateTime64(3)}`);
    }
    const client = await this.resolveClient(projectId);
    const result = await client.query<InstantEvalRunRecord>({
      query: `
        ${latestRowsQuery({ narrowings })}
        ORDER BY t.CreatedAt DESC, t.RunId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: projectId,
        limit,
        ...(before ? { before: toDate(before) } : {}),
        ...(beforeId ? { beforeId } : {}),
      },
      format: "JSONEachRow",
    });
    return (await result.json()).map(toRow);
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
    const at = this.now();
    await this.write({ ...row, status: "FAILED", error: code, updatedAt: at, finishedAt: at });
  }

  /** Per project, so each read routes to the tenant's server; FINAL, as the report always read. */
  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<{ runs: number; firstRunAt?: number }> {
    const window =
      since === undefined ? "" : "AND CreatedAt >= fromUnixTimestamp64Milli({since:Int64})";
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const read = async (query: string) => {
          const result = await client.query({
            query,
            query_params: since === undefined ? { tenantId } : { tenantId, since },
            format: "JSONEachRow",
          });
          return usageRowsSchema.parse(await result.json())[0];
        };
        const [counted, earliest] = await Promise.all([
          read(`
            SELECT toString(count()) AS Total, '0' AS FirstMs
            FROM ${INSTANT_EVAL_RUNS_TABLE} FINAL
            WHERE TenantId = {tenantId:String}
              ${window}`),
          read(`
            SELECT toString(count()) AS Total,
                   toString(toUnixTimestamp64Milli(min(CreatedAt))) AS FirstMs
            FROM ${INSTANT_EVAL_RUNS_TABLE}
            WHERE TenantId = {tenantId:String}`),
        ]);
        return {
          runs: Number.parseInt(counted?.Total ?? "0", 10),
          first:
            Number.parseInt(earliest?.Total ?? "0", 10) === 0
              ? []
              : [Number(earliest?.FirstMs ?? "0")],
        };
      }),
    );
    const firsts = perProject.flatMap((project) => project.first);
    return {
      runs: perProject.reduce((sum, project) => sum + project.runs, 0),
      ...(firsts.length === 0 ? {} : { firstRunAt: Math.min(...firsts) }),
    };
  }

  /** Per project, FINAL for each run's latest counters; folded per day, failures by code. */
  async findDailyRunCounts({
    projectIds,
    since,
    until,
  }: {
    projectIds: readonly string[];
    since: number;
    until: number;
  }): Promise<InstantEvalDailyRunCount[]> {
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT toString(toUnixTimestamp(toStartOfDay(CreatedAt, 'UTC')) * 1000) AS DayMs,
                   Status,
                   ifNull(Error, '') AS ErrorCode,
                   toString(count()) AS Runs,
                   toString(sum(Progress)) AS Judged,
                   toString(max(ifNull(Total, 0))) AS Largest,
                   toString(sum(PriceUsd)) AS PriceUsd,
                   toString(toUnixTimestamp64Milli(max(CreatedAt))) AS LastMs
            FROM ${INSTANT_EVAL_RUNS_TABLE} FINAL
            WHERE TenantId = {tenantId:String}
              AND CreatedAt >= fromUnixTimestamp64Milli({since:Int64})
              AND CreatedAt < fromUnixTimestamp64Milli({until:Int64})
            GROUP BY DayMs, Status, ErrorCode`,
          query_params: { tenantId, since, until },
          format: "JSONEachRow",
        });
        return foldDailyRows({
          projectId: tenantId,
          rows: dailyRowsSchema.parse(await result.json()),
        });
      }),
    );
    return perProject.flat();
  }

  async write(row: InstantEvalRunRow): Promise<void> {
    const client = await this.resolveClient(row.projectId);
    await client.insert({
      table: INSTANT_EVAL_RUNS_TABLE,
      values: [{ ...toWriteRecord({ row, writtenAt: this.now() }) }],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}

type DailyRow = z.infer<typeof dailyRowsSchema>[number];

/** One project's grouped rows folded to one count per day, failures keyed by their code. */
function foldDailyRows({
  projectId,
  rows,
}: {
  projectId: string;
  rows: DailyRow[];
}): InstantEvalDailyRunCount[] {
  const days = new Map<number, InstantEvalDailyRunCount>();
  for (const row of rows) {
    const day = Number(row.DayMs);
    const runs = Number.parseInt(row.Runs, 10);
    const failed = row.Status === "FAILED";
    const known = days.get(day);
    days.set(day, {
      projectId,
      day,
      runs: (known?.runs ?? 0) + runs,
      judgedRows: (known?.judgedRows ?? 0) + Number.parseInt(row.Judged, 10),
      largestRun: Math.max(known?.largestRun ?? 0, Number.parseInt(row.Largest, 10)),
      failedRuns: (known?.failedRuns ?? 0) + (failed ? runs : 0),
      failedByCode: [
        ...(known?.failedByCode ?? []),
        ...(failed ? [{ code: row.ErrorCode, count: runs }] : []),
      ],
      priceUsd: (known?.priceUsd ?? 0) + Number(row.PriceUsd),
      lastRunAt: Math.max(known?.lastRunAt ?? 0, Number(row.LastMs)),
    });
  }
  return [...days.values()];
}
