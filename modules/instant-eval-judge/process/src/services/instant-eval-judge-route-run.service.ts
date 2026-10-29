/**
 * One routed call's legs for questions of one kind: the plan's primary (a first send it may share
 * with other kinds), then the pair in parallel or an escalation for unsure answers, with fallbacks
 * for a backend that is down. Each kind reads sureness its own way; the legs are the same.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  InstantEvalJudgeStoppedError,
  instantEvalSkipped,
  type InstantEvalJudgeRoutePricing,
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
  instantEvalDecisionAnswersOf,
  instantEvalJudgeLegPermitOf,
  instantEvalJudgeLegsJoined,
  instantEvalRoutedVerdictsOf,
  isInstantEvalJudgeLegAnswered,
  isInstantEvalJudgeLegStop,
  type InstantEvalJudgeAnsweredLeg,
  type InstantEvalJudgeFirstLeg,
  type InstantEvalJudgeLeg as Leg,
  type InstantEvalJudgeRoutePlan,
} from "../rules/instant-eval-judge-route.rules.ts";
import { isUnsureAnswer } from "../rules/instant-eval-judge-sureness.rules.ts";
import { InstantEvalJudgeLegDeadlineService } from "./instant-eval-judge-leg-deadline.service.ts";
import { InstantEvalJudgeLlmLegService } from "./instant-eval-judge-llm-leg.service.ts";

export type InstantEvalJudgeRouteRunDeps = Readonly<{
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  classifier: InstantEvalClassifierChannel | undefined;
  hostedDecisions: InstantEvalHostedDecisionsChannel | undefined;
  llmJudge: InstantEvalLlmJudgeChannel;
  limiter: InstantEvalRateLimiter;
}>;

/** One routed call's legs, the calls they paid for and what the routing reports. */
export class InstantEvalJudgeRouteRunService {
  private readonly deps: InstantEvalJudgeRouteRunDeps;
  private readonly plan: InstantEvalJudgeRoutePlan;
  private readonly projectId: string;
  private readonly signal: AbortSignal | undefined;
  private readonly logger: Pick<Logger, "error">;
  private readonly flags: string[] = [];
  private inputTokens = 0;
  private costNanoUsd = 0;

  private constructor(input: {
    deps: InstantEvalJudgeRouteRunDeps;
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

  static create(input: {
    deps: InstantEvalJudgeRouteRunDeps;
    plan: InstantEvalJudgeRoutePlan;
    projectId: string;
    signal: AbortSignal | undefined;
    logger: Pick<Logger, "error">;
  }): InstantEvalJudgeRouteRunService {
    return new InstantEvalJudgeRouteRunService(input);
  }

  /** One kind's judgement from its own first send. */
  judge(questions: readonly InstantEvalQuestion[]): Promise<InstantEvalJudgement> {
    return this.judgeFrom({ questions, first: this.firstLeg(questions) });
  }

  /**
   * One kind's judgement from a first send, its own or one shared with other kinds. A caller's
   * stop after paid legs carries their spend, so the stopped batch still bills it; any other throw
   * after paid legs is a skip carrying that spend, so a merged call bills it too.
   */
  async judgeFrom({
    questions,
    first,
  }: {
    questions: readonly InstantEvalQuestion[];
    first: Promise<InstantEvalJudgeFirstLeg>;
  }): Promise<InstantEvalJudgement> {
    try {
      return await this.judgeLegs({ questions, firstSend: await first });
    } catch (error) {
      if (this.inputTokens <= 0) throw error;
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
    const [a, b] = await Promise.all([
      this.ask({ backend: primary, questions, skip: [pairWith] }),
      this.ask({ backend: pairWith, questions, skip: [primary] }),
    ]);
    return { primary: a, pairWith: b };
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

  /**
   * The first send as this kind's own leg. A shared send that answered none of this kind's
   * questions failed for this kind, so they go to the primary's fallbacks as a failed own send would.
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
    const kind = this.deps.table.backends[backend]?.kind;
    return kind === "anthropic_messages" || kind === "openai_responses";
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
    questions: readonly InstantEvalQuestion[];
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
    questions: readonly InstantEvalQuestion[];
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
    const answers = instantEvalDecisionAnswersOf({ questions, judgement, table: this.deps.table });
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
    questions: readonly InstantEvalQuestion[];
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

  /** One LLM call per question, in parallel; its answer is taken as sure. */
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
    questions: readonly InstantEvalQuestion[];
    timeoutMs: number;
  }): Promise<Leg> {
    // The table refuses an LLM backend with no model at boot; this keeps the type honest.
    if (!model) return { outcome: "failed", reason: "classifier_not_configured" };
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
    const { answers, reason } = await leg.ask({ call: { wire, model, timeoutMs }, questions });
    if (answers.size === 0) return { outcome: "failed", reason };
    if (answers.size < questions.length) this.flags.push(`${backend}_partial:${reason}`);
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
    if (leg.error !== undefined && this.inputTokens <= 0) throw leg.error;
    return { ...instantEvalSkipped(leg.reason), ...this.spent(), routing: this.routing({}) };
  }

  /** The verdicts the legs supplied; a pair's legs waited side by side, so the longer wait. */
  private result({
    questions,
    legs,
    escalated = 0,
    pick,
  }: {
    questions: readonly InstantEvalQuestion[];
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
