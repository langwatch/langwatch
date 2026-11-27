/**
 * A routed run's decision-model leg (the hosted classifier or Decisions): one send under the
 * backend's own deadline, billed as it arrives. Only the caller's stop is rethrown: the leg's own
 * timeout is a leg that failed, so the paid legs before it stay billed.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalJudgeRouteTable,
  InstantEvalJudgement,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalClassifierChannel,
  InstantEvalRateLimiter,
} from "../channels/instant-eval-classifier.channel.ts";
import type { InstantEvalHostedDecisionsChannel } from "../channels/instant-eval-hosted-decisions.channel.ts";
import {
  instantEvalDecisionAnswersOf,
  instantEvalJudgeLegPermitOf,
  isInstantEvalJudgeLegStop,
  type InstantEvalJudgeLeg as Leg,
  type InstantEvalJudgeRoutePlan,
} from "../rules/instant-eval-judge-route.rules.ts";
import { InstantEvalJudgeLegDeadlineService } from "./instant-eval-judge-leg-deadline.service.ts";

type InstantEvalJudgeDecisionLegInput = Readonly<{
  table: InstantEvalJudgeRouteTable;
  classifier: InstantEvalClassifierChannel | undefined;
  hostedDecisions: InstantEvalHostedDecisionsChannel | undefined;
  limiter: InstantEvalRateLimiter;
  projectId: string;
  plan: Pick<InstantEvalJudgeRoutePlan, "inputView" | "text" | "fullText">;
  signal: AbortSignal | undefined;
  /** Adds a routing flag to the run's. */
  flag: (flag: string) => void;
  /** Bills one send's tokens into the run's spend. */
  paid: (spend: { backend: string; inputTokens: number; outputTokens: number }) => void;
}>;

export class InstantEvalJudgeDecisionLegService {
  private constructor(private readonly input: InstantEvalJudgeDecisionLegInput) {}

  static create(input: InstantEvalJudgeDecisionLegInput): InstantEvalJudgeDecisionLegService {
    return new InstantEvalJudgeDecisionLegService(input);
  }

  /** One backend's answer; `text` in place of the plan's view is the gate's framing of the case. */
  async ask({
    backend,
    kind,
    model,
    timeoutMs,
    questions,
    text,
  }: {
    backend: string;
    kind: "jev" | "decisions";
    model: string | undefined;
    timeoutMs: number;
    questions: readonly InstantEvalQuestion[];
    text: string | undefined;
  }): Promise<Leg> {
    const deadline = InstantEvalJudgeLegDeadlineService.create(timeoutMs);
    try {
      return await this.answer({ backend, kind, model, questions, deadline, text });
    } catch (error) {
      if (this.input.signal?.aborted) throw error;
      if (!isInstantEvalJudgeLegStop(error))
        return { outcome: "failed", reason: "classifier_failed", error };
      this.input.flag(`${backend}_timed_out`);
      return { outcome: "failed", reason: "classifier_provider_unavailable" };
    } finally {
      deadline.stop();
    }
  }

  private async answer({
    backend,
    kind,
    model,
    questions,
    deadline,
    text: ownText,
  }: {
    backend: string;
    kind: "jev" | "decisions";
    model: string | undefined;
    questions: readonly InstantEvalQuestion[];
    deadline: InstantEvalJudgeLegDeadlineService;
    text: string | undefined;
  }): Promise<Leg> {
    const text = ownText ?? this.textFor({ backend, kind });
    const judgement = await this.call({ kind, model, text, questions, deadline });
    if (!judgement) {
      this.input.flag(`${backend}_unavailable`);
      return { outcome: "failed", reason: "classifier_provider_unavailable" };
    }
    const { inputTokens, outputTokens = 0 } = judgement;
    this.input.paid({ backend, inputTokens, outputTokens });
    if (judgement.skippedReason) return { outcome: "failed", reason: judgement.skippedReason };
    const { table } = this.input;
    const answers = instantEvalDecisionAnswersOf({ questions, judgement, table });
    if (answers.size === 0) return { outcome: "failed", reason: "classifier_provider_unavailable" };
    return {
      outcome: "answered",
      backend,
      answers,
      isTextTruncated: judgement.isTextTruncated,
      limiterWaitMs: judgement.limiterWaitMs ?? 0,
    };
  }

  /**
   * The decision model's judgement, or undefined when this install holds no channel for it. Each
   * send waits on the limiter (the hosted classifier's own bucket, a per-kind tenant share for
   * Decisions) on the caller's stop alone, with the leg's clock paused meanwhile.
   */
  private async call({
    kind,
    model,
    text,
    questions,
    deadline,
  }: {
    kind: "jev" | "decisions";
    model: string | undefined;
    text: string;
    questions: readonly InstantEvalQuestion[];
    deadline: InstantEvalJudgeLegDeadlineService;
  }): Promise<InstantEvalJudgement | undefined> {
    const { classifier, hostedDecisions, projectId } = this.input;
    const signal = deadline.signalWith(this.input.signal);
    const limiter = deadline.pausing({ limiter: this.input.limiter, signal: this.input.signal });
    if (kind === "jev") {
      return classifier?.classify({ projectId, text, questions, limiter }, signal);
    }
    if (!hostedDecisions || !model) return undefined;
    await limiter.acquire(
      instantEvalJudgeLegPermitOf({ projectId, pool: "decisions", text, questions }),
    );
    return hostedDecisions.classify({ text, questions, model }, signal);
  }

  /**
   * The planned view for a leg whose kind the table allows on it, else the full trace: the plan
   * checks only the primary and pair, so a fallback or a decision-kind escalation is checked here.
   */
  private textFor({ backend, kind }: { backend: string; kind: "jev" | "decisions" }): string {
    const { inputView, text, fullText } = this.input.plan;
    if (inputView === "full" || text === fullText) return text;
    const allowed: readonly string[] = this.input.table.inputViews.allowedKinds[inputView];
    if (allowed.includes(kind)) return text;
    this.input.flag(`${inputView}_view_refused:${backend}`);
    return fullText;
  }
}
