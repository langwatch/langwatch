/**
 * One backend's send in a routed run: a decision model's leg, or one LLM call per question in
 * parallel taken as sure. Only the caller's stop is rethrown: the leg's own timeout is a leg that
 * failed, so the paid legs before it stay billed and the page is not retried for it.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalJudgeReasoningEffort,
  InstantEvalJudgeRouteTable,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import type { Logger } from "@langwatch/observability";

import type {
  InstantEvalClassifierChannel,
  InstantEvalRateLimiter,
} from "../channels/instant-eval-classifier.channel.ts";
import type { InstantEvalHostedDecisionsChannel } from "../channels/instant-eval-hosted-decisions.channel.ts";
import type { InstantEvalLlmJudgeChannel } from "../channels/instant-eval-llm-judge.channel.ts";
import type {
  InstantEvalJudgeLeg as Leg,
  InstantEvalJudgeRoutePlan,
} from "../rules/instant-eval-judge-route.rules.ts";
import { InstantEvalJudgeDecisionLegService } from "./instant-eval-judge-decision-leg.service.ts";
import { InstantEvalJudgeLlmLegService } from "./instant-eval-judge-llm-leg.service.ts";

/** One send's tokens; `isUsageUnread` when the call went out and no usage came back. */
export type InstantEvalJudgeSendSpend = {
  backend: string;
  inputTokens: number;
  outputTokens: number;
  isUsageUnread?: boolean;
};

type InstantEvalJudgeBackendSendInput = Readonly<{
  table: InstantEvalJudgeRouteTable;
  classifier: InstantEvalClassifierChannel | undefined;
  hostedDecisions: InstantEvalHostedDecisionsChannel | undefined;
  llmJudge: InstantEvalLlmJudgeChannel;
  limiter: InstantEvalRateLimiter;
  projectId: string;
  plan: InstantEvalJudgeRoutePlan;
  signal: AbortSignal | undefined;
  logger: Pick<Logger, "error">;
  /** Adds a routing flag to the run's. */
  flag: (flag: string) => void;
}>;

export class InstantEvalJudgeBackendSendService {
  private constructor(private readonly input: InstantEvalJudgeBackendSendInput) {}

  static create(input: InstantEvalJudgeBackendSendInput): InstantEvalJudgeBackendSendService {
    return new InstantEvalJudgeBackendSendService(input);
  }

  /** `text` in place of the plan's view is the gate's framing of the case. */
  async send({
    backend,
    questions,
    text,
    paid,
  }: {
    backend: string;
    questions: readonly InstantEvalQuestion[];
    text?: string | undefined;
    paid: (spend: InstantEvalJudgeSendSpend) => void;
  }): Promise<Leg> {
    const config = this.input.table.backends[backend];
    if (!config) return { outcome: "failed", reason: "classifier_provider_unavailable" };
    if (config.kind !== "jev" && config.kind !== "decisions") {
      return this.askLlm({
        backend,
        wire: config.kind,
        model: config.model,
        questions,
        timeoutMs: config.timeoutMs,
        reasoningEffort: config.reasoningEffort,
        maxOutputTokens: config.maxOutputTokens,
        paid,
      });
    }
    const { table, classifier, hostedDecisions, limiter, projectId, plan, signal, flag } =
      this.input;
    const leg = InstantEvalJudgeDecisionLegService.create({
      table,
      classifier,
      hostedDecisions,
      limiter,
      projectId,
      plan,
      signal,
      flag,
      paid,
    });
    const { kind, model, timeoutMs } = config;
    return leg.ask({ backend, kind, model, timeoutMs, questions, text });
  }

  /** One LLM call per question, in parallel; its answer is taken as sure. */
  private async askLlm({
    backend,
    wire,
    model,
    questions,
    timeoutMs,
    reasoningEffort,
    maxOutputTokens,
    paid,
  }: {
    backend: string;
    wire: "anthropic_messages" | "openai_responses";
    model: string | undefined;
    questions: readonly InstantEvalQuestion[];
    timeoutMs: number;
    reasoningEffort: InstantEvalJudgeReasoningEffort | undefined;
    maxOutputTokens: number | undefined;
    paid: (spend: InstantEvalJudgeSendSpend) => void;
  }): Promise<Leg> {
    // The table refuses an LLM backend with no model at boot; this keeps the type honest.
    if (!model) return { outcome: "failed", reason: "classifier_not_configured" };
    const { llmJudge, limiter, projectId, plan, signal, logger } = this.input;
    const leg = InstantEvalJudgeLlmLegService.create({
      llmJudge,
      limiter,
      projectId,
      job: plan.job,
      text: plan.fullText,
      signal,
      logger,
      paid: (spend) => paid({ backend, ...spend }),
    });
    const call = {
      wire,
      model,
      timeoutMs,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    };
    const { answers, reason } = await leg.ask({ call, questions });
    if (answers.size === 0) return { outcome: "failed", reason };
    if (answers.size < questions.length) this.input.flag(`${backend}_partial:${reason}`);
    return { outcome: "answered", backend, answers, isTextTruncated: false, limiterWaitMs: 0 };
  }
}
