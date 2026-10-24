/**
 * The judge router (ROUTER-PLACEMENT option a): takes the place of the one hosted classifier
 * call when a call carries a route. Plans each question kind the table routes and runs the plans
 * side by side; a kind the table does not route takes today's classifier call.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  InstantEvalJudgeStoppedError,
  instantEvalSkipped,
  type InstantEvalClassification,
  type InstantEvalJudgeRoute,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
  type InstantEvalQuestionKind,
} from "@langwatch/instant-eval-judge-contract";
import { createLogger, type Logger } from "@langwatch/observability";

import { instantEvalJudgeClassifierCostOf } from "../rules/instant-eval-judge-route-cost.rules.ts";
import {
  instantEvalJudgeKindGroupsOf,
  instantEvalMergedJudgementOf,
  type InstantEvalJudgeKindPart,
} from "../rules/instant-eval-judge-route-merge.rules.ts";
import { instantEvalJudgeRoutePlanOf } from "../rules/instant-eval-judge-route.rules.ts";
import {
  InstantEvalJudgeRouteRunService,
  type InstantEvalJudgeRouteRunDeps,
} from "./instant-eval-judge-route-run.service.ts";

const defaultLogger: Logger = createLogger("langwatch:instant-eval-judge:router");

type InstantEvalJudgeRouterServiceDeps = InstantEvalJudgeRouteRunDeps &
  Readonly<{ logger?: Pick<Logger, "error"> }>;

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
   * Yes-or-no questions are always routed, a score or category one when the table routes its
   * kind; the rest take today's classifier call together, priced as a routed one so a run whose
   * calls all carry a route never bills some tokens at zero.
   */
  async classify(input: RoutedClassification): Promise<InstantEvalJudgement> {
    const { questions } = input;
    const { routed, unrouted } = instantEvalJudgeKindGroupsOf({
      questions,
      table: this.deps.table,
    });
    if (routed.length === 0) return this.unrouted(input);
    const parts: Promise<InstantEvalJudgeKindPart>[] = routed.map(async (group) => ({
      kinds: [group.kind],
      isRouted: true,
      judgement: await this.routedRun({ input, questions: group.questions, kind: group.kind }),
    }));
    if (unrouted.length > 0) {
      parts.push(
        this.unrouted({ ...input, questions: unrouted }).then((judgement) => ({
          kinds: [...new Set(unrouted.map((question) => question.kind))],
          isRouted: false,
          judgement,
        })),
      );
    }
    if (parts.length === 1) return (await parts[0]!).judgement;
    return this.merged({ questions, parts, signal: input.signal });
  }

  private routedRun({
    input,
    questions,
    kind,
  }: {
    input: RoutedClassification;
    questions: readonly InstantEvalQuestion[];
    kind: InstantEvalQuestionKind;
  }): Promise<InstantEvalJudgement> {
    const { projectId, text, signal, route } = input;
    const { table } = this.deps;
    const plan = instantEvalJudgeRoutePlanOf({ route, text, questions, table, kind });
    const run = InstantEvalJudgeRouteRunService.create({
      deps: this.deps,
      plan,
      projectId,
      signal,
      logger: this.logger,
    });
    return run.judge(questions);
  }

  /**
   * Every part's verdicts in the order asked. A part that threw fails the call as it would alone;
   * on a caller's stop the error carries every part's paid spend, so the stopped batch bills it.
   */
  private async merged({
    questions,
    parts,
    signal,
  }: {
    questions: readonly InstantEvalQuestion[];
    parts: readonly Promise<InstantEvalJudgeKindPart>[];
    signal: AbortSignal | undefined;
  }): Promise<InstantEvalJudgement> {
    const settled = await Promise.allSettled(parts);
    const done = settled.flatMap((part) => (part.status === "fulfilled" ? [part.value] : []));
    const failure = settled.find((part) => part.status === "rejected");
    if (!failure) return instantEvalMergedJudgementOf({ questions, parts: done });
    if (!signal?.aborted) throw failure.reason;
    const stopped = settled.flatMap((part) =>
      part.status === "rejected" && part.reason instanceof InstantEvalJudgeStoppedError
        ? [part.reason]
        : [],
    );
    let inputTokens = 0;
    let costNanoUsd = 0;
    for (const paid of [...done.map((part) => part.judgement), ...stopped]) {
      inputTokens += paid.inputTokens;
      costNanoUsd += paid.costNanoUsd ?? 0;
    }
    if (inputTokens <= 0) throw failure.reason;
    throw new InstantEvalJudgeStoppedError({ inputTokens, costNanoUsd, cause: failure.reason });
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
