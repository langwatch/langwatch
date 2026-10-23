/**
 * The judge router (ROUTER-PLACEMENT option a): a synchronous step that takes the place of the
 * one hosted classifier call when a call carries a route. Plans, then calls the planned legs:
 * the pair in parallel, an escalation for unsure answers, fallbacks for a backend that is down.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  InstantEvalJudgeStoppedError,
  instantEvalSkipped,
  type InstantEvalBooleanQuestion,
  type InstantEvalClassification,
  type InstantEvalJudgeRoute,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalJudgement,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger, type Logger } from "@langwatch/observability";

import type {
  InstantEvalClassifierChannel,
  InstantEvalRateLimiter,
} from "../channels/instant-eval-classifier.channel.ts";
import type { InstantEvalHostedDecisionsChannel } from "../channels/instant-eval-hosted-decisions.channel.ts";
import type { InstantEvalLlmJudgeChannel } from "../channels/instant-eval-llm-judge.channel.ts";
import {
  instantEvalJudgeCallCostOf,
  instantEvalJudgeClassifierCostOf,
} from "../rules/instant-eval-judge-route-cost.rules.ts";
import {
  instantEvalJudgeLegPermitOf,
  instantEvalJudgeRoutePlanOf,
  instantEvalRoutedVerdictsOf,
  instantEvalVerdictConfidence,
  isInstantEvalBooleanQuestion,
  isInstantEvalJudgeLegAnswered,
  isInstantEvalJudgeLegStop,
  isUnsureVerdict,
  type InstantEvalJudgeAnsweredLeg,
  type InstantEvalJudgeLeg as Leg,
  type InstantEvalJudgeRoutePlan,
} from "../rules/instant-eval-judge-route.rules.ts";
import { InstantEvalJudgeLegDeadlineService } from "./instant-eval-judge-leg-deadline.service.ts";

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
    const booleans = questions.filter(isInstantEvalBooleanQuestion);
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
    const { table, pricing } = this.deps;
    const { inputTokens } = judgement;
    return {
      ...judgement,
      costNanoUsd: instantEvalJudgeClassifierCostOf({ table, pricing, inputTokens }),
    };
  }
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
    const { inputView, isViewMissing, refusedView, longerView } = input.plan;
    if (isViewMissing) this.flags.push(`${inputView}_view_missing`);
    if (refusedView) this.flags.push(`${refusedView}_view_refused`);
    if (longerView) this.flags.push(`${longerView}_view_not_shorter`);
  }

  /** A caller's stop after paid legs carries their spend, so the stopped batch still bills it. */
  async judge(questions: readonly InstantEvalBooleanQuestion[]): Promise<InstantEvalJudgement> {
    try {
      return await this.judgeLegs(questions);
    } catch (error) {
      if (!this.signal?.aborted || this.inputTokens <= 0) throw error;
      throw new InstantEvalJudgeStoppedError({ ...this.spent(), cause: error });
    }
  }

  private async judgeLegs(
    questions: readonly InstantEvalBooleanQuestion[],
  ): Promise<InstantEvalJudgement> {
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
    first: InstantEvalJudgeAnsweredLeg;
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
      return this.result({ questions, legs: [a, b].filter(isInstantEvalJudgeLegAnswered) });
    }
    const winners = new Map<string, InstantEvalJudgeAnsweredLeg>();
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
    const deadline = InstantEvalJudgeLegDeadlineService.create(config.timeoutMs);
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
      if (!isInstantEvalJudgeLegStop(error))
        return { outcome: "failed", reason: "classifier_failed", error };
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
    deadline: InstantEvalJudgeLegDeadlineService;
  }): Promise<Leg> {
    const text = this.textFor({ backend, kind });
    const judgement = await this.callDecisionModel({ kind, model, text, questions, deadline });
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
    text,
    questions,
    deadline,
  }: {
    kind: "jev" | "decisions";
    model: string | undefined;
    text: string;
    questions: readonly InstantEvalBooleanQuestion[];
    deadline: InstantEvalJudgeLegDeadlineService;
  }): Promise<InstantEvalJudgement | undefined> {
    const { classifier, hostedDecisions } = this.deps;
    const signal = deadline.signalWith(this.signal);
    const limiter = deadline.pausing({ limiter: this.deps.limiter, signal: this.signal });
    if (kind === "jev") {
      return classifier?.classify({ projectId: this.projectId, text, questions, limiter }, signal);
    }
    if (!hostedDecisions || !model) return undefined;
    const { projectId } = this;
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
    const { inputView, text, fullText } = this.plan;
    if (inputView === "full" || text === fullText) return text;
    const allowed: readonly string[] = this.deps.table.inputViews.allowedKinds[inputView];
    if (allowed.includes(kind)) return text;
    this.flags.push(`${inputView}_view_refused:${backend}`);
    return fullText;
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
          instantEvalJudgeLegPermitOf({
            projectId: this.projectId,
            pool: "llm",
            text,
            questions: [question],
          }),
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

  /** The verdicts the legs supplied; a pair's legs waited side by side, so the longer wait. */
  private result({
    questions,
    legs,
    escalated = 0,
    pick,
  }: {
    questions: readonly InstantEvalBooleanQuestion[];
    legs: readonly InstantEvalJudgeAnsweredLeg[];
    escalated?: number;
    pick?: (questionId: string) => InstantEvalJudgeAnsweredLeg | undefined;
  }): InstantEvalJudgement {
    const { verdicts, answeredBy } = instantEvalRoutedVerdictsOf({ questions, legs, pick });
    const waits = legs.map((leg) => leg.limiterWaitMs);
    return {
      verdicts,
      isTextTruncated: legs.some((leg) => leg.isTextTruncated),
      limiterWaitMs: pick ? Math.max(0, ...waits) : waits.reduce((sum, ms) => sum + ms, 0),
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
