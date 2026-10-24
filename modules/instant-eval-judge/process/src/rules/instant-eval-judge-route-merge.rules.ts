/**
 * A routed call that asks questions of several kinds: which questions each kind's plan takes,
 * and the one judgement the parts merge into, in the order the questions were asked.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  INSTANT_EVAL_QUESTION_KINDS,
  type InstantEvalJudgeRouteTable,
  type InstantEvalJudgeRouting,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
  type InstantEvalQuestionKind,
} from "@langwatch/instant-eval-judge-contract";

/** The questions of one kind the table routes, in the order asked. */
interface InstantEvalJudgeKindGroup {
  readonly kind: InstantEvalQuestionKind;
  readonly questions: readonly InstantEvalQuestion[];
}

/**
 * Yes or no is always routed; a score or category kind only when the table names it. The rest
 * stay together for today's single classifier call.
 */
export function instantEvalJudgeKindGroupsOf({
  questions,
  table,
}: {
  questions: readonly InstantEvalQuestion[];
  table: InstantEvalJudgeRouteTable;
}): { routed: InstantEvalJudgeKindGroup[]; unrouted: InstantEvalQuestion[] } {
  const isRouted = (kind: InstantEvalQuestionKind) =>
    kind === "boolean" || table.kinds[kind] !== undefined;
  const routed: InstantEvalJudgeKindGroup[] = [];
  for (const kind of INSTANT_EVAL_QUESTION_KINDS) {
    const ofKind = questions.filter((question) => question.kind === kind);
    if (ofKind.length > 0 && isRouted(kind)) routed.push({ kind, questions: ofKind });
  }
  const unrouted = questions.filter((question) => !isRouted(question.kind));
  return { routed, unrouted };
}

/** One kind's (or the unrouted questions') judgement. */
export interface InstantEvalJudgeKindPart {
  readonly kinds: readonly InstantEvalQuestionKind[];
  readonly isRouted: boolean;
  readonly judgement: InstantEvalJudgement;
}

/**
 * The parts as one judgement: verdicts in the order asked, tokens and cost summed, the longest
 * limiter wait (the parts ran side by side). A skip only when no part answered anything. The
 * routing names the first routed part's mode, slot and view; every flag carries its kind.
 */
export function instantEvalMergedJudgementOf({
  questions,
  parts,
}: {
  questions: readonly InstantEvalQuestion[];
  parts: readonly InstantEvalJudgeKindPart[];
}): InstantEvalJudgement {
  const order = new Map(questions.map((question, at) => [question.id, at]));
  const verdicts = parts
    .flatMap((part) => part.judgement.verdicts)
    .toSorted((a, b) => (order.get(a.questionId) ?? 0) - (order.get(b.questionId) ?? 0));
  const skippedReason =
    verdicts.length === 0
      ? (parts.find((part) => part.judgement.skippedReason)?.judgement.skippedReason ??
        "classifier_failed")
      : undefined;
  return {
    verdicts,
    ...(skippedReason ? { skippedReason } : {}),
    inputTokens: parts.reduce((sum, part) => sum + part.judgement.inputTokens, 0),
    isTextTruncated: parts.some((part) => part.judgement.isTextTruncated),
    limiterWaitMs: Math.max(0, ...parts.map((part) => part.judgement.limiterWaitMs ?? 0)),
    costNanoUsd: parts.reduce((sum, part) => sum + (part.judgement.costNanoUsd ?? 0), 0),
    ...routingOf(parts),
  };
}

function routingOf(parts: readonly InstantEvalJudgeKindPart[]): {
  routing?: InstantEvalJudgeRouting;
} {
  const first = parts.find((part) => part.judgement.routing)?.judgement.routing;
  if (!first) return {};
  const answeredBy: Record<string, number> = {};
  let escalated = 0;
  const flags: string[] = [];
  for (const { kinds, isRouted, judgement } of parts) {
    const label = kinds.join(",");
    if (!isRouted) flags.push(`${label}:unrouted`);
    const routing = judgement.routing;
    if (!routing) continue;
    for (const [backend, count] of Object.entries(routing.answeredBy)) {
      answeredBy[backend] = (answeredBy[backend] ?? 0) + count;
    }
    escalated += routing.escalated;
    flags.push(...routing.flags.map((flag) => `${label}:${flag}`));
  }
  return { routing: { ...first, answeredBy, escalated, flags } };
}
