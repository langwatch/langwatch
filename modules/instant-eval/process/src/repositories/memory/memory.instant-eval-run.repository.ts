/**
 * Runs held in process, keyed the way the table is. Composition and service
 * tests run the real graph against this instead of a database.
 */

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

function keyOf({ projectId, runId }: { projectId: string; runId: string }): string {
  return `${projectId}:${runId}`;
}

function newestFirst(left: InstantEvalRunRow, right: InstantEvalRunRow): number {
  const byInstant = right.createdAt.epochMilliseconds - left.createdAt.epochMilliseconds;
  return byInstant === 0 ? right.id.localeCompare(left.id) : byInstant;
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
