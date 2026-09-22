/**
 * Reading a run back. Every judgement read is bounded by the run's own
 * timestamps, which is what prunes partitions instead of walking the table.
 *
 * @see specs/instant-evals/instant-eval-api.feature
 */

import {
  type InstantEvalJudgmentStatus,
  InstantEvalRunNotFoundError,
  type InstantEvalRunProgress,
} from "@langwatch/instant-eval-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalJudgmentPage,
  InstantEvalJudgmentsRepository,
} from "../repositories/instant-eval-judgments.repository.ts";
import type {
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../repositories/instant-eval-run.repository.ts";
import { instantEvalWrittenWindow } from "../rules/instant-eval-judgments.rules.ts";
import { publishedInstantEvalStatus } from "../rules/instant-eval-run-status.rules.ts";

export class InstantEvalReadsService {
  private constructor(
    private readonly runs: InstantEvalRunRepository,
    private readonly judgments: InstantEvalJudgmentsRepository,
    private readonly now: () => Instant,
  ) {}

  static create({
    runs,
    judgments,
    now = nowInstant,
  }: {
    runs: InstantEvalRunRepository;
    judgments: InstantEvalJudgmentsRepository;
    now?: () => Instant;
  }): InstantEvalReadsService {
    return new InstantEvalReadsService(runs, judgments, now);
  }

  /** The run, or the refusal naming the id that has none. */
  async getRun({
    projectId,
    runId,
  }: {
    projectId: string;
    runId: string;
  }): Promise<InstantEvalRunRow> {
    const row = await this.runs.findById({ projectId, runId });
    if (!row) throw new InstantEvalRunNotFoundError({ runId });
    return row;
  }

  /** The project's runs, newest first. Empty when it has none. */
  async findRuns(input: {
    projectId: string;
    limit: number;
    before?: Instant;
    beforeId?: string;
  }): Promise<InstantEvalRunRow[]> {
    return this.runs.findPage(input);
  }

  /** One page of the run's judgements. */
  async getResultsPage({
    projectId,
    runId,
    limit,
    questionId,
    isMatched,
    status,
    cursor,
  }: {
    projectId: string;
    runId: string;
    limit: number;
    questionId?: string;
    isMatched?: boolean;
    status?: InstantEvalJudgmentStatus;
    cursor?: string;
  }): Promise<InstantEvalJudgmentPage> {
    const row = await this.getRun({ projectId, runId });
    return this.judgments.getPage({
      projectId,
      runId,
      ...instantEvalWrittenWindow(row, this.now()),
      limit,
      ...(questionId === undefined ? {} : { questionId }),
      ...(isMatched === undefined ? {} : { matched: isMatched }),
      ...(status === undefined ? {} : { status }),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  /**
   * The counters of the runs a client named, dropping the ids it may not
   * read: the read carrying them is the list the user is looking at, and a
   * refusal there would blank the table for a chip matching nothing.
   */
  async findRunProgress({
    projectId,
    runIds,
  }: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<InstantEvalRunProgress[]> {
    const rows = await Promise.all(runIds.map((runId) => this.runs.findById({ projectId, runId })));
    return rows.filter(isRow).map(toProgress);
  }
}

function isRow(row: InstantEvalRunRow | null): row is InstantEvalRunRow {
  return row !== null;
}

function toProgress(row: InstantEvalRunRow): InstantEvalRunProgress {
  return {
    id: row.id,
    status: publishedInstantEvalStatus(row.status),
    total: row.total,
    progress: row.progress,
    matched: row.matched,
    failed: row.failed,
    skipped: row.skipped,
    error: row.error,
    priceUsd: row.priceUsd,
    finishedAtMs: row.finishedAt?.epochMilliseconds ?? null,
  };
}
