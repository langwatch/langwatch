import {
  clickhouseRead,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { nowInstant, type Instant } from "@langwatch/time";
import { z } from "zod";

import type {
  InstantEvalRunDefinition,
  InstantEvalRunListQuery,
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../instant-eval-run.repository.ts";
import {
  INSTANT_EVAL_RUNS_TABLE,
  type InstantEvalRunRecord,
  latestRunsRead,
  toRow,
  toWriteRecord,
} from "./clickhouse.instant-eval-run.mapper.ts";
import { instantEvalRuns as runs } from "./clickhouse.instant-eval-runs.table.ts";
import type { InstantEvalClickHouseResolver } from "./clickhouse.instant-eval-session.store.ts";

const usageRowsSchema = z.array(
  z.object({ Counted: z.string(), FirstMs: z.string().default("0") }),
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
    const statement = latestRunsRead({ projectId, narrowing: { runId }, limit: 1 });
    const result = await client.read<InstantEvalRunRecord>({ statement });
    const [record] = result.rows;
    return record ? toRow(record) : null;
  }

  async findPage({
    projectId,
    limit,
    before,
    beforeId,
  }: InstantEvalRunListQuery): Promise<InstantEvalRunRow[]> {
    const client = await this.resolveClient(projectId);
    const statement = latestRunsRead({
      projectId,
      narrowing: before
        ? { before: { atMs: before.epochMilliseconds, ...(beforeId ? { runId: beforeId } : {}) } }
        : {},
      limit,
      newestFirst: true,
    });
    const result = await client.read<InstantEvalRunRecord>({ statement });
    return result.rows.map(toRow);
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
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const scope = tenantScope.single({ tenantId });
        const counted = clickhouseRead({ scope })
          .from(runs)
          .final()
          .select({ Counted: fn.toString(fn.count()) });
        const read = async (statement: ReaderReadStatement) =>
          usageRowsSchema.parse((await client.read({ statement })).rows)[0];
        const [total, earliest] = await Promise.all([
          read(
            (since === undefined
              ? counted
              : counted.where(({ gte }) => gte(runs.CreatedAt, since))
            ).build(),
          ),
          read(
            clickhouseRead({ scope })
              .from(runs)
              .select({
                Counted: fn.toString(fn.count()),
                FirstMs: fn.toString(fn.toUnixTimestamp64Milli(fn.min(runs.CreatedAt))),
              })
              .build(),
          ),
        ]);
        return {
          runs: Number.parseInt(total?.Counted ?? "0", 10),
          first:
            Number.parseInt(earliest?.Counted ?? "0", 10) === 0
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
