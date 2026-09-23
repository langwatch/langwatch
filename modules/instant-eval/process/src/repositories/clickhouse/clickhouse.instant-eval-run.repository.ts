import { nowInstant, toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import type { InstantEvalClickHouseResolver } from "../../app/instant-eval.members.ts";
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

const usageRowsSchema = z.array(z.object({ Total: z.string(), FirstMs: z.string() }));

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
