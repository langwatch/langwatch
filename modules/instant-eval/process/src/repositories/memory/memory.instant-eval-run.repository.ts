/**
 * Runs held in process, keyed the way the table is. Composition and service
 * tests run the real graph against this instead of a database.
 */

import type { InstantEvalDailyRunCount } from "@langwatch/instant-eval-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalRunDefinition,
  InstantEvalRunListQuery,
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../instant-eval-run.repository.ts";

export class MemoryInstantEvalRunRepository implements InstantEvalRunRepository {
  private readonly rows = new Map<string, InstantEvalRunRow>();

  private constructor(private readonly now: () => Instant) {}

  static create(now: () => Instant = nowInstant): MemoryInstantEvalRunRepository {
    return new MemoryInstantEvalRunRepository(now);
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
    return this.rows.get(keyOf({ projectId, runId })) ?? null;
  }

  async findPage({
    projectId,
    limit,
    before,
    beforeId,
  }: InstantEvalRunListQuery): Promise<InstantEvalRunRow[]> {
    const page = [...this.rows.values()]
      .filter((row) => row.projectId === projectId)
      .filter((row) => isBeforeCursor({ row, before, beforeId }))
      .toSorted(newestFirst);
    return page.slice(0, limit);
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<{ runs: number; firstRunAt?: number }> {
    const rows = [...this.rows.values()].filter((row) => projectIds.includes(row.projectId));
    const created = rows.map((row) => row.createdAt.epochMilliseconds);
    return {
      runs: created.filter((at) => since === undefined || at >= since).length,
      ...(created.length === 0 ? {} : { firstRunAt: Math.min(...created) }),
    };
  }

  async findDailyRunCounts(input: {
    projectIds: readonly string[];
    since: number;
    until: number;
  }): Promise<InstantEvalDailyRunCount[]> {
    const groups = new Map<string, { row: InstantEvalDailyRunCount; codes: Map<string, number> }>();
    for (const run of this.rows.values()) {
      const at = run.createdAt.epochMilliseconds;
      if (!input.projectIds.includes(run.projectId) || at < input.since || at >= input.until) {
        continue;
      }
      const day = at - (at % DAY_MS);
      const key = `${run.projectId}/${day}`;
      const group = groups.get(key) ?? {
        row: { ...emptyDay({ projectId: run.projectId, day }) },
        codes: new Map<string, number>(),
      };
      const failed = run.status === "FAILED";
      group.row = {
        ...group.row,
        runs: group.row.runs + 1,
        judgedRows: group.row.judgedRows + run.progress,
        largestRun: Math.max(group.row.largestRun, run.total ?? 0),
        failedRuns: group.row.failedRuns + (failed ? 1 : 0),
        priceUsd: group.row.priceUsd + run.priceUsd,
        lastRunAt: Math.max(group.row.lastRunAt, at),
      };
      if (failed) group.codes.set(run.error ?? "", (group.codes.get(run.error ?? "") ?? 0) + 1);
      groups.set(key, group);
    }
    return [...groups.values()].map(({ row, codes }) => ({
      ...row,
      failedByCode: [...codes.entries()].map(([code, count]) => ({ code, count })),
    }));
  }

  async write(row: InstantEvalRunRow): Promise<void> {
    this.rows.set(keyOf({ projectId: row.projectId, runId: row.id }), row);
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
}

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyDay({
  projectId,
  day,
}: {
  projectId: string;
  day: number;
}): InstantEvalDailyRunCount {
  return {
    projectId,
    day,
    runs: 0,
    judgedRows: 0,
    largestRun: 0,
    failedRuns: 0,
    failedByCode: [],
    priceUsd: 0,
    lastRunAt: 0,
  };
}

function keyOf({ projectId, runId }: { projectId: string; runId: string }): string {
  return `${projectId}:${runId}`;
}

function newestFirst(left: InstantEvalRunRow, right: InstantEvalRunRow): number {
  const byInstant = right.createdAt.epochMilliseconds - left.createdAt.epochMilliseconds;
  if (byInstant !== 0) return byInstant;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

/** The same total order the paged read uses: the instant, then the id. */
function isBeforeCursor({
  row,
  before,
  beforeId,
}: {
  row: InstantEvalRunRow;
  before?: Instant;
  beforeId?: string;
}): boolean {
  if (!before) return true;
  const at = row.createdAt.epochMilliseconds;
  const edge = before.epochMilliseconds;
  if (at < edge) return true;
  return beforeId !== undefined && at === edge && row.id < beforeId;
}
