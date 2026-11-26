/**
 * A gated plan's legs: the gate rates each question's case, then the primary answers the easy ones
 * alone and the escalation the rest alone, side by side, with no sureness read. A failed branch
 * is answered by the other backend, flagged; the hard branch is not an escalation (ADR-190 d11).
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalJudgeRouteGate,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import type { Logger } from "@langwatch/observability";

import {
  instantEvalJudgeGateBranchOf,
  instantEvalJudgeGateInputOf,
  instantEvalJudgeGateQuestionOf,
} from "../rules/instant-eval-judge-gate.rules.ts";
import type {
  InstantEvalJudgeLeg as Leg,
  InstantEvalJudgeRoutePlan,
} from "../rules/instant-eval-judge-route.rules.ts";

type InstantEvalJudgeGatedLegsInput = Readonly<{
  plan: Pick<InstantEvalJudgeRoutePlan, "job" | "fullText" | "primary">;
  gate: InstantEvalJudgeRouteGate;
  escalateTo: string;
  logger: Pick<Logger, "error">;
  /** Adds a routing flag to the run's. */
  flag: (flag: string) => void;
  /** The gate's task line for a question: a criterion's raw text, else its instructions. */
  taskOf: (question: InstantEvalQuestion) => string;
  /** A backend, then its fallbacks but those in `skip`. */
  ask: (input: {
    backend: string;
    questions: readonly InstantEvalQuestion[];
    skip: readonly string[];
  }) => Promise<Leg>;
  /** One backend alone, on a text of its own. */
  askOne: (input: {
    backend: string;
    questions: readonly InstantEvalQuestion[];
    text: string;
  }) => Promise<Leg>;
}>;

/** Every leg asked, the questions the escalation answered, and the limiter wait to report. */
type InstantEvalJudgeGatedLegs = Readonly<{ asked: Leg[]; escalated: number; waitMs: number }>;

export class InstantEvalJudgeGatedLegsService {
  private constructor(private readonly input: InstantEvalJudgeGatedLegsInput) {}

  static create(input: InstantEvalJudgeGatedLegsInput): InstantEvalJudgeGatedLegsService {
    return new InstantEvalJudgeGatedLegsService(input);
  }

  async ask(questions: readonly InstantEvalQuestion[]): Promise<InstantEvalJudgeGatedLegs> {
    const { plan, escalateTo } = this.input;
    const { easy, hard, gateWaitMs } = await this.gated(questions);
    const easyAsk = this.askBranch({
      questions: easy,
      backend: plan.primary,
      other: escalateTo,
      failedFlag: "primary_failed",
    });
    const hardAsk = this.askBranch({
      questions: hard,
      backend: escalateTo,
      other: plan.primary,
      failedFlag: "gate_hard_failed",
    });
    // Both settle before a stop is rethrown, so a branch answering after the other stopped bills.
    await Promise.allSettled([easyAsk, hardAsk]);
    const [easyLegs, hardLegs] = [await easyAsk, await hardAsk];
    const asked = [easyLegs.own, easyLegs.other, hardLegs.own, hardLegs.other].filter(
      (leg): leg is Leg => leg !== undefined,
    );
    // The branches waited side by side, so the longer one; a branch's own two asks are in a row.
    const waitMs = gateWaitMs + Math.max(waitOf(easyLegs), waitOf(hardLegs));
    return { asked, escalated: answersIn(easyLegs.other), waitMs };
  }

  /**
   * Each question's branch, from one gate send per question: the gate reads the question as the
   * task, so two questions never share a send. A gate that fails, times out or gives no score
   * sends its question the hard way; only the caller's stop is rethrown, once every send settled.
   */
  private async gated(questions: readonly InstantEvalQuestion[]): Promise<{
    easy: InstantEvalQuestion[];
    hard: InstantEvalQuestion[];
    gateWaitMs: number;
  }> {
    const { gate, plan, flag } = this.input;
    const sends = questions.map((question) => {
      const asked = instantEvalJudgeGateQuestionOf({ name: gate.question, id: question.id });
      const text = instantEvalJudgeGateInputOf({
        job: plan.job,
        task: this.input.taskOf(question),
        text: plan.fullText,
      });
      return this.input.askOne({ backend: gate.backend, questions: [asked], text });
    });
    await Promise.allSettled(sends);
    const rated = await Promise.all(sends);
    const easy: InstantEvalQuestion[] = [];
    const hard: InstantEvalQuestion[] = [];
    let isUnrated = false;
    let gateWaitMs = 0;
    rated.forEach((leg, at) => {
      const question = questions[at]!;
      const verdict =
        leg.outcome === "answered" ? leg.answers.get(question.id)?.verdict : undefined;
      // The sends waited side by side; a send that failed reports no wait, as any failed leg.
      if (leg.outcome === "answered") gateWaitMs = Math.max(gateWaitMs, leg.limiterWaitMs);
      else this.gateFailed({ backend: gate.backend, leg });
      const { branch, hasScore } = instantEvalJudgeGateBranchOf({ verdict, gate });
      if (!hasScore) isUnrated = true;
      (branch === "easy" ? easy : hard).push(question);
    });
    if (isUnrated) flag("gate_no_score");
    if (easy.length > 0) flag("gate:easy");
    if (hard.length > 0) flag("gate:hard");
    return { easy, hard, gateWaitMs };
  }

  /** A gate that could not rate is never fatal; a channel's throw is logged, not rethrown. */
  private gateFailed({
    backend,
    leg,
  }: {
    backend: string;
    leg: Extract<Leg, { outcome: "failed" }>;
  }): void {
    this.input.flag(`${backend}_failed:${leg.reason}`);
    if (leg.error !== undefined) {
      this.input.logger.error({ backend, error: leg.error }, "Instant Evals router gate threw");
    }
  }

  /**
   * One branch's questions from its backend, and those it left from the other backend, flagged.
   * Neither ask falls back onto the other's backend, so each is asked at most once per question.
   */
  private async askBranch({
    questions,
    backend,
    other,
    failedFlag,
  }: {
    questions: readonly InstantEvalQuestion[];
    backend: string;
    other: string;
    failedFlag: string;
  }): Promise<{ own?: Leg; other?: Leg }> {
    if (questions.length === 0) return {};
    const own = await this.input.ask({ backend, questions, skip: [other] });
    const left =
      own.outcome === "failed" ? questions : questions.filter((q) => !own.answers.has(q.id));
    if (left.length === 0) return { own };
    this.input.flag(failedFlag);
    const asked = await this.input.ask({ backend: other, questions: left, skip: [backend] });
    return { own, other: asked };
  }
}

/** How many questions a leg answered; none for a leg that was not asked or failed. */
function answersIn(leg: Leg | undefined): number {
  return leg?.outcome === "answered" ? leg.answers.size : 0;
}

/** What one gated branch waited on the limiter: its own ask, then the other backend's. */
function waitOf({ own, other }: { own?: Leg; other?: Leg }): number {
  return [own, other].reduce(
    (sum, leg) => sum + (leg?.outcome === "answered" ? leg.limiterWaitMs : 0),
    0,
  );
}
