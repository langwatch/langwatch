/**
 * A monitor's Instant Evals judgments in eval_results (ADR-189 section 5): recalled before its
 * judge is called, and kept as `Source = monitor` once judged, behind
 * `release_instant_eval_results`. The monitor's own result still lands in evaluation_runs.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import type {
  InstantEvalMonitorJudgementAnswer,
  InstantEvalMonitorJudgment,
} from "@langwatch/instant-eval-contract";
import type { InstantEvalVerdict } from "@langwatch/instant-eval-judge-contract";
import { nowInstant } from "@langwatch/time";

import type { EvalResultsRepository } from "../repositories/eval-results.repository.ts";
import {
  EVAL_RESULTS_KEY_VERSION,
  EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
  evalResultsJudgeModelOf,
  evalResultsMonitorCellKey,
} from "../rules/eval-results-key.rules.ts";
import {
  evalResultRecordOf,
  recalledEvalResultVerdict,
} from "../rules/eval-results-recall.rules.ts";

/** What this service asks of other modules, each narrowed to the one answer it needs. */
interface EvalResultsMonitorPeers {
  /** Whether the project keeps and recalls its results: `release_instant_eval_results`. */
  isReleased(input: { projectId: string }): Promise<boolean>;
  /** The project's trace retention in days, stamped on every row it writes. */
  retentionDaysOf(input: { projectId: string }): Promise<number>;
}

export class EvalResultsMonitorService {
  private constructor(
    private readonly results: Pick<EvalResultsRepository, "insert" | "findLatestJudged">,
    private readonly peers: EvalResultsMonitorPeers,
    private readonly now: () => number,
  ) {}

  static create({
    results,
    peers,
    now = () => nowInstant().epochMilliseconds,
  }: {
    results: Pick<EvalResultsRepository, "insert" | "findLatestJudged">;
    peers: EvalResultsMonitorPeers;
    now?: () => number;
  }): EvalResultsMonitorService {
    return new EvalResultsMonitorService(results, peers, now);
  }

  /** The latest judged row of the judgment's key, as a verdict for the question asked now. */
  async findJudgments(judgment: InstantEvalMonitorJudgment): Promise<InstantEvalVerdict[]> {
    if (!(await this.peers.isReleased({ projectId: judgment.projectId }))) return [];

    const key = evalResultsMonitorCellKey(judgment);
    const found = await this.results.findLatestJudged({
      tenantId: judgment.projectId,
      judgeModel: evalResultsJudgeModelOf(judgment.judgeModel),
      keyVersion: EVAL_RESULTS_KEY_VERSION,
      keys: [key],
      occurredFrom: key.occurredAt - EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
      occurredUntil: key.occurredAt + EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
    });
    return found.map((recalled) =>
      recalledEvalResultVerdict({ recalled, questionId: judgment.question.id }),
    );
  }

  /** One row for what the judge answered: judged, or the reason it declined or failed. */
  async keep({
    judgement,
    ...judgment
  }: InstantEvalMonitorJudgment & { judgement: InstantEvalMonitorJudgementAnswer }): Promise<void> {
    const { projectId, question } = judgment;
    if (!(await this.peers.isReleased({ projectId }))) return;

    const verdict = judgement.verdicts.find((answer) => answer.questionId === question.id);
    const record = evalResultRecordOf({
      tenantId: projectId,
      key: evalResultsMonitorCellKey(judgment),
      question: { kind: question.kind, question },
      judgeModel: evalResultsJudgeModelOf(judgment.judgeModel),
      source: { kind: "monitor", id: judgment.monitorId },
      outcome: {
        ...(verdict ? { verdict } : {}),
        ...(judgement.skippedReason ? { skippedReason: judgement.skippedReason } : {}),
      },
      judgedAt: this.now(),
      retentionDays: await this.peers.retentionDaysOf({ projectId }),
    });
    await this.results.insert([record]);
  }
}
