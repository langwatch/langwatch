/**
 * The judge router (ROUTER-PLACEMENT option a): a synchronous step that takes the place of the
 * one hosted classifier call when a call carries a route. Plans, then calls the planned legs:
 * the pair in parallel, an escalation for unsure answers, fallbacks for a backend that is down.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  instantEvalSkipped,
  type InstantEvalBooleanQuestion,
  type InstantEvalClassification,
  type InstantEvalJudgeRoute,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger, type Logger } from "@langwatch/observability";

import type {
  InstantEvalClassifierChannel,
  InstantEvalRateLimiter,
} from "../channels/instant-eval-classifier.channel.ts";
import type { InstantEvalHostedDecisionsChannel } from "../channels/instant-eval-hosted-decisions.channel.ts";
import type { InstantEvalLlmJudgeChannel } from "../channels/instant-eval-llm-judge.channel.ts";
import { instantEvalJudgeCallCostOf } from "../rules/instant-eval-judge-route-cost.rules.ts";
import {
  instantEvalJudgeRoutePlanOf,
  instantEvalVerdictConfidence,
  isUnsureVerdict,
  type InstantEvalJudgeRoutePlan,
} from "../rules/instant-eval-judge-route.rules.ts";

const defaultLogger: Logger = createLogger("langwatch:instant-eval-judge:router");

type InstantEvalJudgeRouterServiceDeps = Readonly<{
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  classifier: InstantEvalClassifierChannel | undefined;
  hostedDecisions: InstantEvalHostedDecisionsChannel | undefined;
  llmJudge: InstantEvalLlmJudgeChannel;
  limiter: InstantEvalRateLimiter;
  logger?: Pick<Logger, "warn">;
}>;

/** A routed classification: today's input with the route it carries. */
type RoutedClassification = Omit<InstantEvalClassification, "route" | "decisionModel"> & {
  readonly route: InstantEvalJudgeRoute;
};

/** P(yes) per question one backend answered, or why it could not. */
type Leg =
  | Readonly<{
      outcome: "answered";
      backend: string;
      probabilities: ReadonlyMap<string, number>;
      isTextTruncated: boolean;
      limiterWaitMs: number;
    }>
  | Readonly<{ outcome: "failed"; reason: InstantEvalSkipReason; error?: unknown }>;

export class InstantEvalJudgeRouterService {
  private readonly logger: Pick<Logger, "warn">;

  private constructor(private readonly deps: InstantEvalJudgeRouterServiceDeps) {
    this.logger = deps.logger ?? defaultLogger;
  }

  static create(deps: InstantEvalJudgeRouterServiceDeps): InstantEvalJudgeRouterService {
    return new InstantEvalJudgeRouterService(deps);
  }

  /** Only yes-or-no questions are routed; any other question takes today's classifier call. */
  async classify(input: RoutedClassification): Promise<InstantEvalJudgement> {
    const { projectId, text, questions, signal, route } = input;
    const booleans = questions.filter(isBooleanQuestion);
    if (booleans.length !== questions.length) {
      return this.unrouted({ projectId, text, questions, signal });
    }
    const plan = instantEvalJudgeRoutePlanOf({
      route,
      text,
      questions: booleans,
      table: this.deps.table,
    });
    const run = new RouteRun({ deps: this.deps, plan, projectId, signal, logger: this.logger });
    return run.judge(booleans);
  }

  private async unrouted({
    projectId,
    text,
    questions,
    signal,
  }: Omit<RoutedClassification, "route">): Promise<InstantEvalJudgement> {
    const { classifier, limiter } = this.deps;
    if (!classifier) return instantEvalSkipped("classifier_not_configured");
    return classifier.classify(
      { projectId, text, questions, limiter },
      ...(signal ? [signal] : []),
    );
  }
}

function isBooleanQuestion(question: InstantEvalQuestion): question is InstantEvalBooleanQuestion {
  return question.kind === "boolean";
}

/** One routed call's legs, the calls they paid for and what the routing reports. */
class RouteRun {
  private readonly deps: InstantEvalJudgeRouterServiceDeps;
  private readonly plan: InstantEvalJudgeRoutePlan;
  private readonly projectId: string;
  private readonly signal: AbortSignal | undefined;
  private readonly logger: Pick<Logger, "warn">;
  private readonly flags: string[] = [];
  private inputTokens = 0;
  private costNanoUsd = 0;

  constructor(input: {
    deps: InstantEvalJudgeRouterServiceDeps;
    plan: InstantEvalJudgeRoutePlan;
    projectId: string;
    signal: AbortSignal | undefined;
    logger: Pick<Logger, "warn">;
  }) {
    this.deps = input.deps;
    this.plan = input.plan;
    this.projectId = input.projectId;
    this.signal = input.signal;
    this.logger = input.logger;
    const { inputView, isViewMissing, refusedView } = input.plan;
    if (isViewMissing) this.flags.push(`${inputView}_view_missing`);
    if (refusedView) this.flags.push(`${refusedView}_view_refused`);
  }

  async judge(questions: readonly InstantEvalBooleanQuestion[]): Promise<InstantEvalJudgement> {
    const { primary, pairWith, escalateTo } = this.plan;
    if (pairWith) return this.pair({ questions, primary, pairWith });
    const first = await this.ask({ backend: primary, questions });
    if (first.outcome === "failed") {
      if (!escalateTo) return this.nothingAnswered(first);
      this.flags.push("primary_failed");
      const second = await this.ask({ backend: escalateTo, questions });
      if (second.outcome === "failed") return this.nothingAnswered(second);
      return this.result({ questions, legs: [second], escalated: second.probabilities.size });
    }
    return this.escalateUnsure({ questions, first });
  }

  private async escalateUnsure({
    questions,
    first,
  }: {
    questions: readonly InstantEvalBooleanQuestion[];
    first: Extract<Leg, { outcome: "answered" }>;
  }): Promise<InstantEvalJudgement> {
    const { escalateTo, threshold } = this.plan;
    const unsure =
      escalateTo === undefined || threshold === undefined
        ? []
        : questions.filter((q) =>
            isUnsureVerdict({ probability: first.probabilities.get(q.id), threshold }),
          );
    if (!escalateTo || unsure.length === 0) return this.result({ questions, legs: [first] });
    const second = await this.ask({ backend: escalateTo, questions: unsure });
    const escalated = second.outcome === "answered" ? second.probabilities.size : 0;
    if (escalated < unsure.length) this.flags.push("escalation_failed");
    if (second.outcome === "failed") return this.result({ questions, legs: [first] });
    return this.result({ questions, legs: [second, first], escalated });
  }

  /** Both legs at once; per question the surer answer wins, the primary on a tie. */
  private async pair({
    questions,
    primary,
    pairWith,
  }: {
    questions: readonly InstantEvalBooleanQuestion[];
    primary: string;
    pairWith: string;
  }): Promise<InstantEvalJudgement> {
    const [a, b] = await Promise.all([
      this.ask({ backend: primary, questions, skip: [pairWith] }),
      this.ask({ backend: pairWith, questions, skip: [primary] }),
    ]);
    if (a.outcome === "failed" && b.outcome === "failed") return this.nothingAnswered(a);
    if (a.outcome === "failed" || b.outcome === "failed") {
      return this.result({ questions, legs: [a, b].filter(isAnswered) });
    }
    const winners = new Map<string, Extract<Leg, { outcome: "answered" }>>();
    for (const question of questions) {
      const pa = instantEvalVerdictConfidence(a.probabilities.get(question.id));
      const pb = instantEvalVerdictConfidence(b.probabilities.get(question.id));
      winners.set(question.id, pa >= pb ? a : b);
    }
    return this.result({ questions, legs: [a, b], pick: (id) => winners.get(id) });
  }

  /** A backend, then its enabled fallbacks except those in `skip`; the last failure otherwise. */
  private async ask({
    backend,
    questions,
    skip = [],
  }: {
    backend: string;
    questions: readonly InstantEvalBooleanQuestion[];
    skip?: readonly string[];
  }): Promise<Leg> {
    const candidates = [
      backend,
      ...(this.plan.fallbacks[backend] ?? []).filter((fallback) => !skip.includes(fallback)),
    ];
    let last: Leg = { outcome: "failed", reason: "classifier_provider_unavailable" };
    for (const candidate of candidates) {
      last = await this.askOne({ backend: candidate, questions });
      if (last.outcome === "answered") {
        if (candidate !== backend) this.flags.push(`fallback:${backend}->${candidate}`);
        return last;
      }
      this.flags.push(`${candidate}_failed:${last.reason}`);
    }
    return last;
  }

  /** One backend's answer; a stop by the caller is rethrown, any other failure is a leg failed. */
  private async askOne({
    backend,
    questions,
  }: {
    backend: string;
    questions: readonly InstantEvalBooleanQuestion[];
  }): Promise<Leg> {
    const config = this.deps.table.backends[backend];
    if (!config) return { outcome: "failed", reason: "classifier_provider_unavailable" };
    const signal = legSignal({ signal: this.signal, timeoutMs: config.timeoutMs });
    try {
      if (config.kind === "jev" || config.kind === "decisions") {
        return await this.askDecisionModel({
          backend,
          kind: config.kind,
          model: config.model,
          questions,
          signal,
        });
      }
      return await this.askLlm({
        backend,
        wire: config.kind,
        model: config.model,
        questions,
        timeoutMs: config.timeoutMs,
      });
    } catch (error) {
      if (this.signal?.aborted) throw error;
      return { outcome: "failed", reason: "classifier_failed", error };
    }
  }

  private async askDecisionModel({
    backend,
    kind,
    model,
    questions,
    signal,
  }: {
    backend: string;
    kind: "jev" | "decisions";
    model: string | undefined;
    questions: readonly InstantEvalBooleanQuestion[];
    signal: AbortSignal;
  }): Promise<Leg> {
    const { classifier, hostedDecisions, limiter } = this.deps;
    const text = this.plan.text;
    const channelMissing = kind === "jev" ? !classifier : !hostedDecisions;
    if (channelMissing) {
      this.flags.push(`${backend}_unavailable`);
      return { outcome: "failed", reason: "classifier_provider_unavailable" };
    }
    const judgement =
      kind === "jev"
        ? await classifier!.classify(
            { projectId: this.projectId, text, questions, limiter },
            signal,
          )
        : await hostedDecisions!.classify({ text, questions, ...(model ? { model } : {}) }, signal);
    this.paid({ backend, inputTokens: judgement.inputTokens, outputTokens: 0 });
    if (judgement.skippedReason) return { outcome: "failed", reason: judgement.skippedReason };
    const probabilities = new Map<string, number>();
    for (const verdict of judgement.verdicts) {
      if (verdict.probability !== undefined)
        probabilities.set(verdict.questionId, verdict.probability);
    }
    if (probabilities.size === 0)
      return { outcome: "failed", reason: "classifier_provider_unavailable" };
    return {
      outcome: "answered",
      backend,
      probabilities,
      isTextTruncated: judgement.isTextTruncated,
      limiterWaitMs: judgement.limiterWaitMs ?? 0,
    };
  }

  /** One LLM call per question, in parallel; a verdict reads as P(yes) of one or zero. */
  private async askLlm({
    backend,
    wire,
    model,
    questions,
    timeoutMs,
  }: {
    backend: string;
    wire: "anthropic_messages" | "openai_responses";
    model: string | undefined;
    questions: readonly InstantEvalBooleanQuestion[];
    timeoutMs: number;
  }): Promise<Leg> {
    const answers = await Promise.all(
      questions.map((question) =>
        this.deps.llmJudge.judge(
          {
            wire,
            ...(model ? { model } : {}),
            job: this.plan.job,
            question,
            text: this.plan.fullText,
            timeoutMs,
          },
          ...(this.signal ? [this.signal] : []),
        ),
      ),
    );
    const probabilities = new Map<string, number>();
    let reason: InstantEvalSkipReason = "classifier_provider_unavailable";
    answers.forEach((answer, at) => {
      this.paid({ backend, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens });
      if (answer.outcome === "answered")
        probabilities.set(questions[at]!.id, answer.verdict ? 1 : 0);
      else reason = answer.reason;
    });
    if (probabilities.size === 0) return { outcome: "failed", reason };
    return {
      outcome: "answered",
      backend,
      probabilities,
      isTextTruncated: false,
      limiterWaitMs: 0,
    };
  }

  private paid({
    backend,
    inputTokens,
    outputTokens,
  }: {
    backend: string;
    inputTokens: number;
    outputTokens: number;
  }): void {
    if (inputTokens <= 0 && outputTokens <= 0) return;
    this.inputTokens += inputTokens;
    const cost = instantEvalJudgeCallCostOf({
      backend,
      inputTokens,
      outputTokens,
      pricing: this.deps.pricing,
    });
    if (cost.outcome === "priced") {
      this.costNanoUsd += cost.costNanoUsd;
      return;
    }
    this.flags.push(`unpriced:${backend}`);
    this.logger.warn({ backend }, "Instant Evals router called a backend with no configured price");
  }

  /** Nothing answered: the platform's skip reason, or today's throw when a channel threw. */
  private nothingAnswered(leg: Extract<Leg, { outcome: "failed" }>): InstantEvalJudgement {
    if (leg.error !== undefined) throw leg.error;
    return { ...instantEvalSkipped(leg.reason), ...this.spent(), routing: this.routing({}) };
  }

  /** Per question the first leg (or `pick`) holding an answer supplies the verdict. */
  private result({
    questions,
    legs,
    escalated = 0,
    pick,
  }: {
    questions: readonly InstantEvalBooleanQuestion[];
    legs: readonly Extract<Leg, { outcome: "answered" }>[];
    escalated?: number;
    pick?: (questionId: string) => Extract<Leg, { outcome: "answered" }> | undefined;
  }): InstantEvalJudgement {
    const answeredBy: Record<string, number> = {};
    const verdicts = [];
    for (const question of questions) {
      const leg = pick?.(question.id) ?? legs.find((l) => l.probabilities.has(question.id));
      const probability = leg?.probabilities.get(question.id);
      if (!leg || probability === undefined) continue;
      verdicts.push({ questionId: question.id, probability });
      answeredBy[leg.backend] = (answeredBy[leg.backend] ?? 0) + 1;
    }
    return {
      verdicts,
      isTextTruncated: legs.some((leg) => leg.isTextTruncated),
      limiterWaitMs: legs.reduce((sum, leg) => sum + leg.limiterWaitMs, 0),
      ...this.spent(),
      routing: this.routing({ answeredBy, escalated }),
    };
  }

  private spent() {
    return { inputTokens: this.inputTokens, costNanoUsd: this.costNanoUsd };
  }

  private routing({
    answeredBy = {},
    escalated = 0,
  }: {
    answeredBy?: Record<string, number>;
    escalated?: number;
  }) {
    const { mode, slot, inputView } = this.plan;
    return { answeredBy, escalated, mode, slot, inputView, flags: [...this.flags] };
  }
}

function isAnswered(leg: Leg): leg is Extract<Leg, { outcome: "answered" }> {
  return leg.outcome === "answered";
}

function legSignal({
  signal,
  timeoutMs,
}: {
  signal: AbortSignal | undefined;
  timeoutMs: number;
}): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
