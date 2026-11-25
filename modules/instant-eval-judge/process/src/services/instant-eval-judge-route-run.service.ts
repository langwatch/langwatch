/**
 * One routed call's legs for questions of one kind: the plan's primary (a first send it may share
 * with other kinds), then the pair in parallel or an escalation for unsure answers, with fallbacks
 * for a backend that is down. A gated plan asks its gate, then the primary or the escalation alone.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  InstantEvalJudgeStoppedError,
  instantEvalSkipped,
  isInstantEvalJudgeLlmKind,
  isInstantEvalSpendBillable,
  type InstantEvalJudgeLlmKind,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeReasoningEffort,
  type InstantEvalJudgeRouteGate,
  type InstantEvalJudgeRouteTable,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import type { Logger } from "@langwatch/observability";

import type {
  InstantEvalClassifierChannel,
  InstantEvalRateLimiter,
} from "../channels/instant-eval-classifier.channel.ts";
import type { InstantEvalHostedDecisionsChannel } from "../channels/instant-eval-hosted-decisions.channel.ts";
import type { InstantEvalLlmJudgeChannel } from "../channels/instant-eval-llm-judge.channel.ts";
import { instantEvalJudgeCallCostOf } from "../rules/instant-eval-judge-route-cost.rules.ts";
import {
  instantEvalJudgeLegsJoined,
  instantEvalRoutedVerdictsOf,
  isInstantEvalJudgeLegAnswered,
  type InstantEvalJudgeAnsweredLeg,
  type InstantEvalJudgeFirstLeg,
  type InstantEvalJudgeLeg as Leg,
  type InstantEvalJudgeRoutePlan,
} from "../rules/instant-eval-judge-route.rules.ts";
import { isUnsureAnswer } from "../rules/instant-eval-judge-sureness.rules.ts";
import { instantEvalScenarioLlmVerdictOf } from "../rules/instant-eval-scenario-judge.rules.ts";
import { InstantEvalJudgeDecisionLegService } from "./instant-eval-judge-decision-leg.service.ts";
import { InstantEvalJudgeGatedLegsService } from "./instant-eval-judge-gated-legs.service.ts";
import { InstantEvalJudgeLlmLegService } from "./instant-eval-judge-llm-leg.service.ts";
import type {
  InstantEvalScenarioLlmVerdictCall,
  InstantEvalScenarioLlmVerdictService,
} from "./instant-eval-scenario-llm-verdict.service.ts";

export type InstantEvalJudgeRouteRunDeps = Readonly<{
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  classifier: InstantEvalClassifierChannel | undefined;
  hostedDecisions: InstantEvalHostedDecisionsChannel | undefined;
  llmJudge: InstantEvalLlmJudgeChannel;
  limiter: InstantEvalRateLimiter;
}>;

/**
 * A scenario criterion's routed call: its LLM legs read the judge's own verdict call, shared by
 * every criterion of the judgement, by this criterion's key instead of asking a question.
 */
export type InstantEvalJudgeScenarioLeg = Readonly<{
  criterionKey: string;
  verdicts: InstantEvalScenarioLlmVerdictService;
}>;

type InstantEvalJudgeRouteRunInput = Readonly<{
  deps: InstantEvalJudgeRouteRunDeps;
  plan: InstantEvalJudgeRoutePlan;
  projectId: string;
  signal: AbortSignal | undefined;
  logger: Pick<Logger, "error">;
  scenario?: InstantEvalJudgeScenarioLeg | undefined;
}>;

/** One routed call's legs, the calls they paid for and what the routing reports. */
export class InstantEvalJudgeRouteRunService {
  private readonly deps: InstantEvalJudgeRouteRunDeps;
  private readonly plan: InstantEvalJudgeRoutePlan;
  private readonly projectId: string;
  private readonly signal: AbortSignal | undefined;
  private readonly logger: Pick<Logger, "error">;
  private readonly scenario: InstantEvalJudgeScenarioLeg | undefined;
  private readonly flags: string[] = [];
  private inputTokens = 0;
  private costNanoUsd = 0;

  private constructor(input: InstantEvalJudgeRouteRunInput) {
    this.deps = input.deps;
    this.plan = input.plan;
    this.projectId = input.projectId;
    this.signal = input.signal;
    this.logger = input.logger;
    this.scenario = input.scenario;
    const { inputView, isViewMissing, refusedView, longerView } = input.plan;
    if (isViewMissing) this.flags.push(`${inputView}_view_missing`);
    if (refusedView) this.flags.push(`${refusedView}_view_refused`);
    if (longerView) this.flags.push(`${longerView}_view_not_shorter`);
  }

  static create(input: InstantEvalJudgeRouteRunInput): InstantEvalJudgeRouteRunService {
    return new InstantEvalJudgeRouteRunService(input);
  }

  /**
   * One kind's judgement from a first send, its own or one shared; a gated plan takes none. A
   * caller's stop after paid legs carries their spend, so the stopped batch still bills it; any
   * other throw after paid legs is a skip carrying that spend, so a merged call bills it too.
   */
  async judgeFrom({
    questions,
    first,
  }: {
    questions: readonly InstantEvalQuestion[];
    first?: Promise<InstantEvalJudgeFirstLeg> | undefined;
  }): Promise<InstantEvalJudgement> {
    try {
      const { gate, escalateTo } = this.plan;
      // The table refuses a gate with no escalation at boot; without one the plan runs ungated.
      if (gate && escalateTo) return await this.judgeGated({ questions, gate, escalateTo });
      return await this.judgeLegs({
        questions,
        firstSend: await (first ?? this.firstLeg(questions)),
      });
    } catch (error) {
      if (!this.isPaid()) throw error;
      if (this.signal?.aborted) {
        throw new InstantEvalJudgeStoppedError({ ...this.spent(), cause: error });
      }
      this.logger.error({ error }, "Instant Evals routed run failed after paid legs");
      return {
        ...instantEvalSkipped("classifier_failed"),
        ...this.spent(),
        routing: this.routing({}),
      };
    }
  }

  /** The plan's first send for these questions: the primary, or both legs of a pair at once. */
  async firstLeg(questions: readonly InstantEvalQuestion[]): Promise<InstantEvalJudgeFirstLeg> {
    const { primary, pairWith } = this.plan;
    if (!pairWith) return { primary: await this.ask({ backend: primary, questions }) };
    const a = this.ask({ backend: primary, questions, skip: [pairWith] });
    const b = this.ask({ backend: pairWith, questions, skip: [primary] });
    // Both settle before a stop is rethrown, so a leg answering after the other stopped is billed.
    await Promise.allSettled([a, b]);
    return { primary: await a, pairWith: await b };
  }

  private async judgeLegs({
    questions,
    firstSend,
  }: {
    questions: readonly InstantEvalQuestion[];
    firstSend: InstantEvalJudgeFirstLeg;
  }): Promise<InstantEvalJudgement> {
    const { primary, escalateTo } = this.plan;
    if (firstSend.pairWith)
      return this.pair({ questions, a: firstSend.primary, b: firstSend.pairWith });
    const first = await this.ownAnswer({ questions, first: firstSend.primary });
    if (first.outcome === "failed") {
      if (!escalateTo) return this.nothingAnswered(first);
      this.flags.push("primary_failed");
      const second = await this.ask({ backend: escalateTo, questions, skip: [primary] });
      if (second.outcome === "failed") return this.nothingAnswered(second);
      return this.result({ questions, legs: [second], escalated: second.answers.size });
    }
    return this.escalateUnsure({ questions, first });
  }

  /** A gated plan: its gate, then each question's branch alone (ADR-190 decision 11). */
  private async judgeGated({
    questions,
    gate,
    escalateTo,
  }: {
    questions: readonly InstantEvalQuestion[];
    gate: InstantEvalJudgeRouteGate;
    escalateTo: string;
  }): Promise<InstantEvalJudgement> {
    const { asked, escalated, waitMs } = await InstantEvalJudgeGatedLegsService.create({
      plan: this.plan,
      gate,
      escalateTo,
      logger: this.logger,
      flag: (flag) => this.flags.push(flag),
      ask: (input) => this.ask(input),
      askOne: (input) => this.askOne(input),
    }).ask(questions);
    const legs = asked.filter(isInstantEvalJudgeLegAnswered);
    const failed = asked.findLast((leg) => leg.outcome === "failed");
    if (legs.length === 0 && failed?.outcome === "failed") return this.nothingAnswered(failed);
    return this.result({ questions, legs, escalated, waitMs });
  }

  /**
   * The first send as this kind's own leg. A shared send that answered none of this kind's
   * questions failed for this kind, so they go to the primary's fallbacks, as a failed send would.
   */
  private async ownAnswer({
    questions,
    first,
  }: {
    questions: readonly InstantEvalQuestion[];
    first: Leg;
  }): Promise<Leg> {
    if (first.outcome === "failed" || questions.some((q) => first.answers.has(q.id))) return first;
    const { primary } = this.plan;
    this.flags.push(`${primary}_failed:classifier_provider_unavailable`);
    return this.ask({ backend: primary, questions, skip: [primary] });
  }

  private async escalateUnsure({
    questions,
    first,
  }: {
    questions: readonly InstantEvalQuestion[];
    first: InstantEvalJudgeAnsweredLeg;
  }): Promise<InstantEvalJudgement> {
    const { escalateTo, threshold } = this.plan;
    const unsure =
      escalateTo === undefined || threshold === undefined
        ? []
        : questions.filter((q) =>
            isUnsureAnswer({ sureness: first.answers.get(q.id)?.sureness ?? 0, threshold }),
          );
    if (!escalateTo || unsure.length === 0) return this.result({ questions, legs: [first] });
    // The escalation's fallbacks never ask the primary again: it already answered or failed.
    const second = await this.ask({
      backend: escalateTo,
      questions: unsure,
      skip: [this.plan.primary],
    });
    const escalated = second.outcome === "answered" ? second.answers.size : 0;
    if (escalated < unsure.length) this.flags.push("escalation_failed");
    if (second.outcome === "failed") return this.result({ questions, legs: [first] });
    return this.result({ questions, legs: [second, first], escalated });
  }

  /** A pair's two legs; per question the surer answer by its kind's rule wins, primary on a tie. */
  private pair({
    questions,
    a,
    b,
  }: {
    questions: readonly InstantEvalQuestion[];
    a: Leg;
    b: Leg;
  }): InstantEvalJudgement {
    if (a.outcome === "failed" && b.outcome === "failed") return this.nothingAnswered(a);
    if (a.outcome === "failed" || b.outcome === "failed") {
      return this.result({ questions, legs: [a, b].filter(isInstantEvalJudgeLegAnswered) });
    }
    const winners = new Map<string, InstantEvalJudgeAnsweredLeg>();
    for (const question of questions) {
      const pa = a.answers.get(question.id)?.sureness ?? -1;
      const pb = b.answers.get(question.id)?.sureness ?? -1;
      winners.set(question.id, pa >= pb ? a : b);
    }
    return this.result({ questions, legs: [a, b], pick: (id) => winners.get(id) });
  }

  /**
   * A backend, then its enabled fallbacks, leaving out those in `skip`; the last failure otherwise.
   * An LLM that answered only some questions leaves the rest to the next fallback.
   */
  private async ask({
    backend,
    questions,
    skip = [],
  }: {
    backend: string;
    questions: readonly InstantEvalQuestion[];
    skip?: readonly string[];
  }): Promise<Leg> {
    const candidates = [backend, ...(this.plan.fallbacks[backend] ?? [])].filter(
      (candidate) => !skip.includes(candidate),
    );
    let last: Leg = { outcome: "failed", reason: "classifier_provider_unavailable" };
    let answered: InstantEvalJudgeAnsweredLeg | undefined;
    let pending = questions;
    for (const candidate of candidates) {
      const leg = await this.askOne({ backend: candidate, questions: pending });
      last = leg;
      if (leg.outcome === "failed") {
        this.flags.push(`${candidate}_failed:${leg.reason}`);
        continue;
      }
      if (candidate !== backend) this.flags.push(`fallback:${backend}->${candidate}`);
      answered = instantEvalJudgeLegsJoined({ first: answered, next: leg });
      pending = pending.filter((question) => !leg.answers.has(question.id));
      if (pending.length === 0 || !this.isLlm(candidate)) return answered;
    }
    return answered ?? last;
  }

  private isLlm(backend: string): boolean {
    return isInstantEvalJudgeLlmKind(this.deps.table.backends[backend]?.kind);
  }

  /**
   * One backend's answer. Only the caller's stop is rethrown: the leg's own timeout is a leg that
   * failed, so the paid legs before it stay billed and the page is not retried for it.
   */
  private async askOne({
    backend,
    questions,
    text,
  }: {
    backend: string;
    questions: readonly InstantEvalQuestion[];
    /** A decision model's own text in place of the plan's view: the gate's framing of the case. */
    text?: string;
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
        reasoningEffort: config.reasoningEffort,
      });
    }
    const { table, classifier, hostedDecisions, limiter } = this.deps;
    const leg = InstantEvalJudgeDecisionLegService.create({
      table,
      classifier,
      hostedDecisions,
      limiter,
      projectId: this.projectId,
      plan: this.plan,
      signal: this.signal,
      flag: (flag) => this.flags.push(flag),
      paid: (spend) => this.paid(spend),
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
  }: {
    backend: string;
    wire: InstantEvalJudgeLlmKind;
    model: string | undefined;
    questions: readonly InstantEvalQuestion[];
    timeoutMs: number;
    reasoningEffort: InstantEvalJudgeReasoningEffort | undefined;
  }): Promise<Leg> {
    // The table refuses an LLM backend with no model at boot; this keeps the type honest.
    if (!model) return { outcome: "failed", reason: "classifier_not_configured" };
    const call = { wire, model, timeoutMs, ...(reasoningEffort ? { reasoningEffort } : {}) };
    if (this.scenario) {
      return this.readScenarioVerdict({ scenario: this.scenario, backend, call, questions });
    }
    const { llmJudge, limiter } = this.deps;
    const leg = InstantEvalJudgeLlmLegService.create({
      llmJudge,
      limiter,
      projectId: this.projectId,
      job: this.plan.job,
      text: this.plan.fullText,
      signal: this.signal,
      logger: this.logger,
      paid: (spend) => this.paid({ backend, ...spend }),
    });
    const { answers, reason } = await leg.ask({ call, questions });
    if (answers.size === 0) return { outcome: "failed", reason };
    if (answers.size < questions.length) this.flags.push(`${backend}_partial:${reason}`);
    return { outcome: "answered", backend, answers, isTextTruncated: false, limiterWaitMs: 0 };
  }

  /** The judgement's shared verdict call on this backend, read by this criterion's key. */
  private async readScenarioVerdict({
    scenario: { criterionKey, verdicts },
    backend,
    call,
    questions,
  }: {
    scenario: InstantEvalJudgeScenarioLeg;
    backend: string;
    call: InstantEvalScenarioLlmVerdictCall;
    questions: readonly InstantEvalQuestion[];
  }): Promise<Leg> {
    const reading = await verdicts.read({
      backend,
      call,
      paid: (spend) => this.paid({ backend, ...spend }),
    });
    if (reading.outcome === "failed") return { outcome: "failed", reason: reading.reason };
    const answer = reading.criteria.get(criterionKey);
    if (answer === undefined) return { outcome: "failed", reason: "classifier_failed" };
    const answers = new Map(
      questions.map((question) => [
        question.id,
        {
          verdict: instantEvalScenarioLlmVerdictOf({ questionId: question.id, answer }),
          sureness: 1,
        },
      ]),
    );
    return { outcome: "answered", backend, answers, isTextTruncated: false, limiterWaitMs: 0 };
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

  /**
   * Nothing answered: the platform's skip reason, carrying any paid legs' spend. A channel's throw
   * is rethrown, as an unrouted call does, only when nothing was paid.
   */
  private nothingAnswered(leg: Extract<Leg, { outcome: "failed" }>): InstantEvalJudgement {
    if (leg.error !== undefined && !this.isPaid()) throw leg.error;
    return { ...instantEvalSkipped(leg.reason), ...this.spent(), routing: this.routing({}) };
  }

  /**
   * The verdicts the legs supplied; a pair's legs waited side by side, so the longer wait. A gated
   * plan gives its branches' wait itself.
   */
  private result({
    questions,
    legs,
    escalated = 0,
    pick,
    waitMs,
  }: {
    questions: readonly InstantEvalQuestion[];
    legs: readonly InstantEvalJudgeAnsweredLeg[];
    escalated?: number;
    pick?: (questionId: string) => InstantEvalJudgeAnsweredLeg | undefined;
    waitMs?: number;
  }): InstantEvalJudgement {
    const { verdicts, answeredBy } = instantEvalRoutedVerdictsOf({ questions, legs, pick });
    const waits = legs.map((leg) => leg.limiterWaitMs);
    const legsWaitMs =
      waitMs ?? (pick ? Math.max(0, ...waits) : waits.reduce((sum, ms) => sum + ms, 0));
    return {
      verdicts,
      isTextTruncated: legs.some((leg) => leg.isTextTruncated),
      limiterWaitMs: legsWaitMs,
      ...this.spent(),
      routing: this.routing({ answeredBy, escalated }),
    };
  }

  private spent() {
    return { inputTokens: this.inputTokens, costNanoUsd: this.costNanoUsd };
  }

  /** Whether a leg billed anything, input tokens or a cost for output alone. */
  private isPaid(): boolean {
    return isInstantEvalSpendBillable(this.spent());
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
