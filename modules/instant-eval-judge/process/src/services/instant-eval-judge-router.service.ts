/**
 * The judge router (ROUTER-PLACEMENT option a): takes the place of the one hosted classifier
 * call when a call carries a route. Plans each question kind the table routes and runs the plans
 * side by side; a kind the table does not route takes today's classifier call.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  INSTANT_EVAL_QUESTION_KINDS,
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
   * Routed when the router can take every question (yes or no always, a score or category when
   * the table routes its kind); otherwise the whole call takes today's classifier call, priced as
   * a routed one so a run whose calls all carry a route never bills some tokens at zero.
   */
  async classify(input: RoutedClassification): Promise<InstantEvalJudgement> {
    const { questions } = input;
    const groups = instantEvalJudgeKindGroupsOf({ questions, table: this.deps.table });
    if (groups.length === 0) return this.unrouted(input);
    const parts = groups.map(async (group) => ({
      kind: group.kind,
      judgement: await this.routedRun({ input, questions: group.questions, kind: group.kind }),
    }));
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
   * Every part's verdicts in the order asked. A kind whose run threw is a skip of that kind, so the
   * paid parts stay billed; when none answered and none paid, the throw is today's. On a caller's
   * stop the error carries every part's paid spend, so the stopped batch bills it.
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
    if (signal?.aborted) throw this.stopped({ settled, done, cause: failure.reason });
    const isPaid = done.some((part) => part.judgement.inputTokens > 0);
    if (!isPaid && !done.some((part) => part.judgement.verdicts.length > 0)) throw failure.reason;
    const failed = groupsThatThrew({ settled, kinds: kindsOf(questions) });
    const skips = failed.map((kind) => ({
      kind,
      judgement: instantEvalSkipped("classifier_failed"),
    }));
    return instantEvalMergedJudgementOf({ questions, parts: [...done, ...skips] });
  }

  /** The caller's stop, carrying what every part paid; the bare stop when nothing was paid. */
  private stopped({
    settled,
    done,
    cause,
  }: {
    settled: readonly PromiseSettledResult<InstantEvalJudgeKindPart>[];
    done: readonly InstantEvalJudgeKindPart[];
    cause: unknown;
  }): unknown {
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
    if (inputTokens <= 0) return cause;
    return new InstantEvalJudgeStoppedError({ inputTokens, costNanoUsd, cause });
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

/** The kinds asked, in the order the parts were started (the kinds' own order). */
function kindsOf(questions: readonly InstantEvalQuestion[]): InstantEvalQuestionKind[] {
  return INSTANT_EVAL_QUESTION_KINDS.filter((kind) => questions.some((q) => q.kind === kind));
}

/** The kinds whose run threw, by position: parts start in the kinds' order. */
function groupsThatThrew({
  settled,
  kinds,
}: {
  settled: readonly PromiseSettledResult<InstantEvalJudgeKindPart>[];
  kinds: readonly InstantEvalQuestionKind[];
}): InstantEvalQuestionKind[] {
  return kinds.filter((_, at) => settled[at]?.status === "rejected");
}
