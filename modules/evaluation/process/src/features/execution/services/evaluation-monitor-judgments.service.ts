/**
 * A monitor's judge on Instant Evals recalls its verdict from instant-eval's eval_results before
 * judging, and keeps what it judged (ADR-189 section 5). `release_instant_eval_results` is read
 * here before any call; each call is bounded, and a failure only logs, so a run never changes.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  EVAL_RESULTS_MONITOR_TIMEOUT_MS,
  INSTANT_EVAL_RESULTS_FLAG,
  type InstantEvalMonitorJudgeModel,
  type InstantEvalMonitorJudgementAnswer,
  type InstantEvalMonitorJudgment,
} from "@langwatch/instant-eval-contract";
import type {
  InstantEvalQuestion,
  InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";

import type { EvaluationInstantEvalResults } from "../../../channels/evaluation-instant-eval-results.channel.ts";
import type { InstantEvalJudgeInputs } from "../../../rules/instant-eval-judge-question.rules.ts";

const logger = createLogger("langwatch:evaluation:monitor-judgments");

/** The monitor a queued evaluation runs for; a guardrail's run is never kept. */
export type EvaluationMonitorReference = Readonly<{ id: string; isGuardrail: boolean }>;

/** A monitor's run at the level it judged; a thread's text has no single trace (ADR-189 s. 2). */
export type EvaluationMonitorRun = EvaluationMonitorReference &
  Readonly<{ isThreadLevel: boolean }>;

/** One judge call, with what it would be kept under when a monitor on a trace made it. */
type EvaluationMonitorJudgmentCall = Readonly<{
  projectId: string;
  /** The judge call's one organization lookup, shared with the judge router's flag reads. */
  organizationOf: () => Promise<string | undefined>;
  monitor?: EvaluationMonitorRun | undefined;
  traceId?: string | undefined;
  /** The trace's start, epoch milliseconds. */
  occurredAt?: number | undefined;
  question: InstantEvalQuestion;
  inputs: InstantEvalJudgeInputs;
  judgeModel: InstantEvalMonitorJudgeModel;
}>;

/** Not kept: judge as today. Recalled: serve it. Missed: judge, then keep under `judgment`. */
type EvaluationMonitorRecall =
  | Readonly<{ kind: "not_kept" }>
  | Readonly<{ kind: "recalled"; verdict: InstantEvalVerdict }>
  | Readonly<{ kind: "missed"; judgment: InstantEvalMonitorJudgment }>;

const NOT_KEPT: EvaluationMonitorRecall = { kind: "not_kept" };

export class EvaluationMonitorJudgmentsService {
  private constructor(
    private readonly results: EvaluationInstantEvalResults,
    private readonly flags: Pick<FeatureFlagApi, "isEnabled">,
    private readonly timeoutMs: number,
  ) {}

  static create({
    results,
    flags,
    timeoutMs = EVAL_RESULTS_MONITOR_TIMEOUT_MS,
  }: {
    results: EvaluationInstantEvalResults;
    flags: Pick<FeatureFlagApi, "isEnabled">;
    timeoutMs?: number;
  }): EvaluationMonitorJudgmentsService {
    return new EvaluationMonitorJudgmentsService(results, flags, timeoutMs);
  }

  /**
   * The kept verdict, or a miss to judge and keep. A guardrail, a thread-level run, a call outside
   * a monitor or with no trace is `not_kept` before the flag is read; so is a project without it.
   */
  async recall(call: EvaluationMonitorJudgmentCall): Promise<EvaluationMonitorRecall> {
    const { monitor, traceId, occurredAt, organizationOf, ...asked } = call;
    if (!monitor || monitor.isGuardrail || monitor.isThreadLevel) return NOT_KEPT;
    if (!traceId || occurredAt === undefined) return NOT_KEPT;
    if (!(await this.isKept({ projectId: call.projectId, organizationOf }))) return NOT_KEPT;

    const judgment: InstantEvalMonitorJudgment = {
      ...asked,
      monitorId: monitor.id,
      traceId,
      occurredAt,
    };
    try {
      const [verdict] = await this.bounded(this.results.findMonitorJudgments(judgment));
      return verdict ? { kind: "recalled", verdict } : { kind: "missed", judgment };
    } catch (error) {
      logger.warn(
        { projectId: call.projectId, monitorId: monitor.id, traceId, error },
        "Instant Evals monitor recall failed; judging as without kept results",
      );
      return { kind: "missed", judgment };
    }
  }

  /** Keeps a missed judgment's answer; a write that fails or runs late is logged, never thrown. */
  async keep({
    judgment,
    judgement,
  }: {
    judgment: InstantEvalMonitorJudgment;
    judgement: InstantEvalMonitorJudgementAnswer;
  }): Promise<void> {
    try {
      await this.bounded(this.results.keepMonitorJudgment({ ...judgment, judgement }));
    } catch (error) {
      logger.warn(
        {
          projectId: judgment.projectId,
          monitorId: judgment.monitorId,
          traceId: judgment.traceId,
          error,
        },
        "Instant Evals monitor result could not be kept; the result was still delivered",
      );
    }
  }

  /** The flag under the same timeout; a read that fails or runs late keeps nothing. */
  private async isKept(target: {
    projectId: string;
    organizationOf: () => Promise<string | undefined>;
  }): Promise<boolean> {
    const { projectId } = target;
    try {
      return await this.bounded(this.flagOf(target));
    } catch (error) {
      logger.warn({ projectId, error }, "release_instant_eval_results could not be read in time");
      return false;
    }
  }

  /** Read within the organization, from the lookup the judge router's reads share. */
  private async flagOf({
    projectId,
    organizationOf,
  }: {
    projectId: string;
    organizationOf: () => Promise<string | undefined>;
  }): Promise<boolean> {
    const organizationId = await organizationOf();
    return this.flags.isEnabled(INSTANT_EVAL_RESULTS_FLAG, {
      kind: "project",
      projectId,
      ...(organizationId === undefined ? {} : { organizationId }),
    });
  }

  /** The call's answer, or a rejection once the timeout passes; the late answer is dropped. */
  private async bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer within ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
