/**
 * The judge router (ROUTER-PLACEMENT option a): a synchronous step that takes the place of the
 * one hosted classifier call when a call carries a route. Plans, then calls the planned legs:
 * the pair in parallel, an escalation for unsure answers, fallbacks for a backend that is down.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  estimateJudgedTextTokens,
  instantEvalCostUsd,
  instantEvalQuestionTokens,
  instantEvalSkipped,
  NANO_USD_PER_USD,
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
import { nowInstant } from "@langwatch/time";

import type {
  InstantEvalClassifierChannel,
  InstantEvalPermit,
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
  logger?: Pick<Logger, "error">;
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
  private readonly logger: Pick<Logger, "error">;

  private constructor(private readonly deps: InstantEvalJudgeRouterServiceDeps) {
    this.logger = deps.logger ?? defaultLogger;
  }

  static create(deps: InstantEvalJudgeRouterServiceDeps): InstantEvalJudgeRouterService {
    return new InstantEvalJudgeRouterService(deps);
  }

  /**
   * Only yes-or-no questions are routed; any other question takes today's classifier call, priced
   * as a routed one so a run whose calls all carry a route never bills some tokens at zero.
   */
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
    const judgement = await classifier.classify(
      { projectId, text, questions, limiter },
      ...(signal ? [signal] : []),
    );
    return { ...judgement, costNanoUsd: this.classifierCostNanoUsd(judgement.inputTokens) };
  }

  /** The hosted classifier's cost: its backend's routed price, else the published rate. */
  private classifierCostNanoUsd(inputTokens: number): number {
    const { table, pricing } = this.deps;
    for (const [backend, config] of Object.entries(table.backends)) {
      if (config.kind !== "jev") continue;
      const cost = instantEvalJudgeCallCostOf({ backend, inputTokens, outputTokens: 0, pricing });
      if (cost.outcome === "priced") return cost.costNanoUsd;
    }
    return Math.round(instantEvalCostUsd({ inputTokens }) * NANO_USD_PER_USD);
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
  private readonly logger: Pick<Logger, "error">;
  private readonly flags: string[] = [];
  private inputTokens = 0;
  private costNanoUsd = 0;

  constructor(input: {
    deps: InstantEvalJudgeRouterServiceDeps;
    plan: InstantEvalJudgeRoutePlan;
    projectId: string;
    signal: AbortSignal | undefined;
    logger: Pick<Logger, "error">;
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
      const second = await this.ask({ backend: escalateTo, questions, skip: [primary] });
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
    // The escalation's fallbacks never ask the primary again: it already answered or failed.
    const second = await this.ask({
      backend: escalateTo,
      questions: unsure,
      skip: [this.plan.primary],
    });
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

  /**
   * One backend's answer. Only the caller's stop is rethrown: the leg's own timeout is a leg that
   * failed, so the paid legs before it stay billed and the page is not retried for it.
   */
  private async askOne({
    backend,
    questions,
  }: {
    backend: string;
    questions: readonly InstantEvalBooleanQuestion[];
  }): Promise<Leg> {
    const config = this.deps.table.backends[backend];
    if (!config) return { outcome: "failed", reason: "classifier_provider_unavailable" };
    if (config.kind !== "jev" && config.kind !== "decisions") {
      return this.askLlm({
        backend,
        wire: config.kind,
        model: config.model,
        questions,
        timeoutMs: config.timeoutMs,
      });
    }
    const deadline = LegDeadline.start(config.timeoutMs);
    try {
      return await this.askDecisionModel({
        backend,
        kind: config.kind,
        model: config.model,
        questions,
        deadline,
      });
    } catch (error) {
      if (this.signal?.aborted) throw error;
      if (!isStop(error)) return { outcome: "failed", reason: "classifier_failed", error };
      this.flags.push(`${backend}_timed_out`);
      return { outcome: "failed", reason: "classifier_provider_unavailable" };
    } finally {
      deadline.stop();
    }
  }

  private async askDecisionModel({
    backend,
    kind,
    model,
    questions,
    deadline,
  }: {
    backend: string;
    kind: "jev" | "decisions";
    model: string | undefined;
    questions: readonly InstantEvalBooleanQuestion[];
    deadline: LegDeadline;
  }): Promise<Leg> {
    const judgement = await this.callDecisionModel({ kind, model, questions, deadline });
    if (!judgement) {
      this.flags.push(`${backend}_unavailable`);
      return { outcome: "failed", reason: "classifier_provider_unavailable" };
    }
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

  /**
   * The decision model's judgement, or undefined when this install holds no channel for it. Each
   * send waits on the limiter (the hosted classifier's own bucket, a per-kind tenant share for
   * Decisions) on the caller's stop alone, with the leg's clock paused meanwhile.
   */
  private async callDecisionModel({
    kind,
    model,
    questions,
    deadline,
  }: {
    kind: "jev" | "decisions";
    model: string | undefined;
    questions: readonly InstantEvalBooleanQuestion[];
    deadline: LegDeadline;
  }): Promise<InstantEvalJudgement | undefined> {
    const { classifier, hostedDecisions } = this.deps;
    const { text } = this.plan;
    const signal = deadline.signalWith(this.signal);
    const limiter = deadline.pausing({ limiter: this.deps.limiter, signal: this.signal });
    if (kind === "jev") {
      return classifier?.classify({ projectId: this.projectId, text, questions, limiter }, signal);
    }
    if (!hostedDecisions || !model) return undefined;
    await limiter.acquire(this.permitOf({ pool: "decisions", text, questions }));
    return hostedDecisions.classify({ text, questions, model }, signal);
  }

  /** One send's ask of the limiter: a tenant share per leg kind, under the shared global cap. */
  private permitOf({
    pool,
    text,
    questions,
  }: {
    pool: "decisions" | "llm";
    text: string;
    questions: readonly InstantEvalBooleanQuestion[];
  }): InstantEvalPermit {
    return {
      tokens: estimateJudgedTextTokens({ text }) + instantEvalQuestionTokens(questions),
      tenantId: `${this.projectId}:${pool}`,
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
    // The table refuses an LLM backend with no model at boot; this keeps the type honest.
    if (!model) return { outcome: "failed", reason: "classifier_not_configured" };
    const text = this.plan.fullText;
    const answers = await Promise.all(
      questions.map(async (question) => {
        // Each question is a send of the full text, so each one draws on the limiter.
        await this.deps.limiter.acquire(
          this.permitOf({ pool: "llm", text, questions: [question] }),
          this.signal,
        );
        return this.deps.llmJudge.judge(
          { wire, model, job: this.plan.job, question, text, timeoutMs },
          ...(this.signal ? [this.signal] : []),
        );
      }),
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
    // Boot refuses a table with an unpriced reachable backend, so this is a bug, not a deploy slip.
    this.logger.error(
      { backend },
      "Instant Evals router called a backend with no configured price",
    );
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

/** A leg's own timeout or the stop it caused, as the channels and the limiter throw it. */
function isStop(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/**
 * A leg's provider timeout, apart from the caller's stop. Its clock runs only while the leg is
 * with the provider: waiting on a rate limiter pauses it, so queueing never times a leg out.
 */
class LegDeadline {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private startedAtMs = 0;
  private isStopped = false;

  private constructor(private remainingMs: number) {}

  static start(timeoutMs: number): LegDeadline {
    const deadline = new LegDeadline(timeoutMs);
    deadline.resume();
    return deadline;
  }

  /** What the channel is handed: the leg's timeout, and the caller's stop when there is one. */
  signalWith(caller: AbortSignal | undefined): AbortSignal {
    const own = this.controller.signal;
    return caller ? AbortSignal.any([caller, own]) : own;
  }

  pausing({
    limiter,
    signal,
  }: {
    limiter: InstantEvalRateLimiter;
    signal: AbortSignal | undefined;
  }): InstantEvalRateLimiter {
    return {
      acquire: async (permit) => {
        this.pause();
        try {
          await limiter.acquire(permit, signal);
        } finally {
          this.resume();
        }
      },
    };
  }

  stop(): void {
    this.isStopped = true;
    this.clear();
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private pause(): void {
    if (this.timer === undefined) return;
    this.clear();
    this.remainingMs -= nowInstant().epochMilliseconds - this.startedAtMs;
  }

  private resume(): void {
    if (this.isStopped || this.controller.signal.aborted || this.timer !== undefined) return;
    this.startedAtMs = nowInstant().epochMilliseconds;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.controller.abort(new DOMException("The routed leg timed out", "TimeoutError"));
      },
      Math.max(0, this.remainingMs),
    );
  }
}
