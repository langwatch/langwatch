/**
 * Recall before judging, and keep what was judged (ADR-189 section 2). A text is sent only for
 * the questions no kept row answers yet; the misses it answers are written in one batch. A
 * recall adds no row, and a failed or skipped row never stands in for a verdict.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import type { InstantEvalTraceResultSource } from "@langwatch/instant-eval-contract";
import type {
  InstantEvalJudgement,
  InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  EvalResultsRepository,
  RecalledEvalResult,
} from "../repositories/eval-results.repository.ts";
import {
  EVAL_RESULTS_KEY_VERSION,
  EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
  type EvalResultsCellKey,
  evalResultsMatchKeyId,
  findEvalResultsCellKeys,
} from "../rules/eval-results-key.rules.ts";
import {
  evalResultRecordOf,
  recalledEvalResultVerdict,
} from "../rules/eval-results-recall.rules.ts";
import type { InstantEvalJudgementUnit } from "../rules/instant-eval-judge-page.rules.ts";
import type { InstantEvalRunQuestion } from "../rules/instant-eval-run-questions.rules.ts";

const logger = createLogger("langwatch:instant-eval:eval-results");

/** Who asked, as the kept rows name it: a query, a run or a widget, by its id. */
export interface EvalResultsSourceReference {
  readonly kind: InstantEvalTraceResultSource;
  readonly id: string;
}

/** What this service asks of other modules, each narrowed to the one answer it needs. */
export interface EvalResultsRecallPeers {
  /** Whether the project keeps and recalls its results: `release_instant_eval_results`. */
  isReleased(input: { projectId: string }): Promise<boolean>;
  /** The model the project's texts are judged with, as the rows record it. */
  judgeModelOf(input: { projectId: string }): Promise<string>;
  /** The project's trace retention in days, stamped on every row it writes. */
  retentionDaysOf(input: { projectId: string }): Promise<number>;
}

/** One cell recall answered. */
export interface EvalResultsRecalledCell {
  readonly rowIndex: number;
  readonly questionId: string;
  readonly verdict: InstantEvalVerdict;
}

/** One cell recall missed, and the key it is kept under once judged. */
export interface EvalResultsPendingCell {
  readonly rowIndex: number;
  readonly question: InstantEvalRunQuestion;
  readonly key: EvalResultsCellKey;
}

/** A batch after recall: what is left to judge, what was recalled, and what to keep. */
export interface EvalResultsRecall {
  readonly units: readonly InstantEvalJudgementUnit[];
  readonly recalled: readonly EvalResultsRecalledCell[];
  readonly pending: readonly EvalResultsPendingCell[];
  /** The judge the batch is keyed on; empty when nothing is kept. */
  readonly judgeModel: string;
}

/** One unit the judge answered, or lost. */
export interface EvalResultsJudgedUnit {
  readonly unit: InstantEvalJudgementUnit;
  readonly judgement: InstantEvalJudgement;
}

export class EvalResultsRecallService {
  private constructor(
    private readonly results: Pick<EvalResultsRepository, "insert" | "findLatestJudged">,
    private readonly peers: EvalResultsRecallPeers,
    private readonly now: () => number,
  ) {}

  static create({
    results,
    peers,
    now = () => nowInstant().epochMilliseconds,
  }: {
    results: Pick<EvalResultsRepository, "insert" | "findLatestJudged">;
    peers: EvalResultsRecallPeers;
    now?: () => number;
  }): EvalResultsRecallService {
    return new EvalResultsRecallService(results, peers, now);
  }

  /**
   * The units with every recalled question taken out, and a unit with none left dropped. Nothing
   * is read where no cell can be kept or the project is not released; a failed read is a miss.
   */
  async recall({
    projectId,
    rows,
    units,
  }: {
    projectId: string;
    rows: readonly Record<string, unknown>[];
    units: readonly InstantEvalJudgementUnit[];
  }): Promise<EvalResultsRecall> {
    const keyed = keyedCellsOf({ rows, units });
    const untouched = { units, recalled: [], pending: [], judgeModel: "" };
    if (keyed.length === 0) return untouched;
    const judgeModel = await this.#releasedJudgeModelOf({ projectId });
    if (judgeModel === null) return untouched;

    const hits = await this.#latestByKey({ projectId, judgeModel, keyed });
    const recalled: EvalResultsRecalledCell[] = [];
    const pending: EvalResultsPendingCell[] = [];
    for (const cell of keyed) {
      const hit = hits.get(evalResultsMatchKeyId(cell.key));
      if (!hit) {
        pending.push(cell);
        continue;
      }
      const questionId = cell.question.id;
      const verdict = recalledEvalResultVerdict({ recalled: hit, questionId });
      recalled.push({ rowIndex: cell.rowIndex, questionId, verdict });
    }

    return { units: withoutRecalled({ units, recalled }), recalled, pending, judgeModel };
  }

  /**
   * The misses the judge answered or lost, kept in one batch. Never fails the caller: the
   * verdicts are correct and paid for, so a row that could not be kept is a log line.
   */
  async write({
    projectId,
    source,
    recall,
    judged,
  }: {
    projectId: string;
    source: EvalResultsSourceReference;
    recall: EvalResultsRecall;
    judged: readonly EvalResultsJudgedUnit[];
  }): Promise<void> {
    if (recall.pending.length === 0 || judged.length === 0) return;
    const pendingByCell = new Map(
      recall.pending.map((cell) => [cellId(cell.rowIndex, cell.question.id), cell]),
    );
    try {
      const retentionDays = await this.peers.retentionDaysOf({ projectId });
      const judgedAt = this.now();
      const records = judged.flatMap(({ unit, judgement }) =>
        unit.questions.flatMap((question) => {
          const cell = pendingByCell.get(cellId(unit.rowIndex, question.id));
          if (!cell) return [];
          const verdict = judgement.verdicts.find((answer) => answer.questionId === question.id);
          return [
            evalResultRecordOf({
              tenantId: projectId,
              key: cell.key,
              question: cell.question,
              judgeModel: recall.judgeModel,
              source,
              outcome: {
                ...(verdict ? { verdict } : {}),
                ...(judgement.skippedReason ? { skippedReason: judgement.skippedReason } : {}),
              },
              judgedAt,
              retentionDays,
            }),
          ];
        }),
      );
      await this.results.insert(records);
    } catch (error) {
      logger.error(
        { projectId, source: source.kind, sourceId: source.id, error },
        "Instant Evals results could not be kept; the verdicts were still delivered",
      );
    }
  }

  /**
   * The judge model a released project's rows key on, or null to recall nothing. A flag or model
   * read that throws is null too: recall is a saving, so it never fails the ask or the run.
   */
  async #releasedJudgeModelOf({ projectId }: { projectId: string }): Promise<string | null> {
    try {
      if (!(await this.peers.isReleased({ projectId }))) return null;
      return await this.peers.judgeModelOf({ projectId });
    } catch (error) {
      logger.warn(
        { projectId, error },
        "Instant Evals recall could not read its flag or judge model; judging as if it were off",
      );
      return null;
    }
  }

  /** The latest judged row per key, by key; a read that fails judges everything instead. */
  async #latestByKey({
    projectId,
    judgeModel,
    keyed,
  }: {
    projectId: string;
    judgeModel: string;
    keyed: readonly EvalResultsPendingCell[];
  }): Promise<ReadonlyMap<string, RecalledEvalResult>> {
    const times = keyed.map((cell) => cell.key.occurredAt);
    try {
      const found = await this.results.findLatestJudged({
        tenantId: projectId,
        judgeModel,
        keyVersion: EVAL_RESULTS_KEY_VERSION,
        keys: keyed.map((cell) => cell.key),
        occurredFrom: Math.min(...times) - EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
        occurredUntil: Math.max(...times) + EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
      });
      return new Map(found.map((row) => [evalResultsMatchKeyId(row), row]));
    } catch (error) {
      logger.warn({ projectId, error }, "Instant Evals recall failed; judging every text instead");
      return new Map();
    }
  }
}

/** Every cell of the batch that can be kept, with its key. */
function keyedCellsOf({
  rows,
  units,
}: {
  rows: readonly Record<string, unknown>[];
  units: readonly InstantEvalJudgementUnit[];
}): readonly EvalResultsPendingCell[] {
  return units.flatMap((unit) => {
    const row = rows[unit.rowIndex];
    if (!row) return [];
    return unit.questions.flatMap((question) =>
      findEvalResultsCellKeys({ row, question, text: unit.text }).map((key) => ({
        rowIndex: unit.rowIndex,
        question,
        key,
      })),
    );
  });
}

/** The units with their recalled questions taken out; a unit with none left is not sent. */
function withoutRecalled({
  units,
  recalled,
}: {
  units: readonly InstantEvalJudgementUnit[];
  recalled: readonly EvalResultsRecalledCell[];
}): readonly InstantEvalJudgementUnit[] {
  const answered = new Set(recalled.map((cell) => cellId(cell.rowIndex, cell.questionId)));
  return units.flatMap((unit) => {
    const questions = unit.questions.filter(
      (question) => !answered.has(cellId(unit.rowIndex, question.id)),
    );
    if (questions.length === 0) return [];
    return [questions.length === unit.questions.length ? unit : { ...unit, questions }];
  });
}

/** A row and a question as one map key. A row index is a number, so no separator collides. */
function cellId(rowIndex: number, questionId: string): string {
  return `${rowIndex}|${questionId}`;
}
