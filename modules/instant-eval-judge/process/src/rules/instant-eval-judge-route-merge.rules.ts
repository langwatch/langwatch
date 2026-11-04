/**
 * A routed call that asks questions of several kinds: whether every kind can be routed, each
 * kind's questions, and the one judgement the parts merge into, in the order asked.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  INSTANT_EVAL_QUESTION_KINDS,
  type InstantEvalJudgeRouteTable,
  type InstantEvalJudgeRouting,
  type InstantEvalJudgement,
  type InstantEvalQuestion,
  type InstantEvalQuestionKind,
  type InstantEvalSkipReason,
} from "@langwatch/instant-eval-judge-contract";

import type { InstantEvalJudgeRoutePlan } from "./instant-eval-judge-route.rules.ts";

/** The questions of one kind, in the order asked. */
interface InstantEvalJudgeKindGroup {
  readonly kind: InstantEvalQuestionKind;
  readonly questions: readonly InstantEvalQuestion[];
}

/**
 * The call's questions by kind when the router can take every one; none when any is of a kind
 * the table does not route, or malformed (a range not whole or inverted, no or repeated options).
 * Then the whole call keeps today's one classifier call instead of routing part of it.
 */
export function instantEvalJudgeKindGroupsOf({
  questions,
  table,
}: {
  questions: readonly InstantEvalQuestion[];
  table: InstantEvalJudgeRouteTable;
}): InstantEvalJudgeKindGroup[] {
  if (!questions.every((question) => isRoutable({ question, table }))) return [];
  return INSTANT_EVAL_QUESTION_KINDS.flatMap((kind) => {
    const ofKind = questions.filter((question) => question.kind === kind);
    return ofKind.length > 0 ? [{ kind, questions: ofKind }] : [];
  });
}

/**
 * Per kind's plan, the first kind whose plan makes the same first send: a decision-model primary
 * with the same pair partner, input view, text and fallbacks. Those kinds send once with all
 * their questions, and each escalates from that answer. An LLM asks per question, never shared.
 */
export function instantEvalJudgeFirstSendLeadsOf({
  plans,
  table,
}: {
  plans: readonly InstantEvalJudgeRoutePlan[];
  table: InstantEvalJudgeRouteTable;
}): number[] {
  const isShareable = (plan: InstantEvalJudgeRoutePlan) => {
    const kind = table.backends[plan.primary]?.kind;
    return kind === "jev" || kind === "decisions";
  };
  return plans.map((plan, at) =>
    isShareable(plan) ? plans.findIndex((lead) => isSameFirstSend(lead, plan)) : at,
  );
}

function isSameFirstSend(a: InstantEvalJudgeRoutePlan, b: InstantEvalJudgeRoutePlan): boolean {
  const fallbacksOf = (plan: InstantEvalJudgeRoutePlan) =>
    [plan.primary, plan.pairWith].map((backend) => plan.fallbacks[backend ?? ""] ?? []);
  return (
    a.primary === b.primary &&
    a.pairWith === b.pairWith &&
    a.inputView === b.inputView &&
    a.text === b.text &&
    JSON.stringify(fallbacksOf(a)) === JSON.stringify(fallbacksOf(b))
  );
}

function isRoutable({
  question,
  table,
}: {
  question: InstantEvalQuestion;
  table: InstantEvalJudgeRouteTable;
}): boolean {
  if (question.kind === "boolean") return true;
  if (!table.kinds[question.kind]) return false;
  if (question.kind === "score") {
    const { min, max } = question.range;
    return Number.isInteger(min) && Number.isInteger(max) && min <= max;
  }
  const names = question.options.map((option) => option.name);
  return names.length > 0 && new Set(names).size === names.length;
}

/** One kind's routed judgement, or why that kind's run threw while others answered. */
export type InstantEvalJudgeKindPart = Readonly<{
  kind: InstantEvalQuestionKind;
  judgement: InstantEvalJudgement;
}>;

/**
 * The parts as one judgement: verdicts in the order asked, tokens and cost summed, the longest
 * limiter wait (the parts ran side by side). A skip only when no part answered anything. The
 * routing names the first part's mode, slot and view; every flag carries its kind.
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
  const skippedReason: InstantEvalSkipReason | undefined =
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
  for (const { kind, judgement } of parts) {
    if (judgement.skippedReason) flags.push(`${kind}:skipped:${judgement.skippedReason}`);
    const routing = judgement.routing;
    if (!routing) continue;
    for (const [backend, count] of Object.entries(routing.answeredBy)) {
      answeredBy[backend] = (answeredBy[backend] ?? 0) + count;
    }
    escalated += routing.escalated;
    flags.push(...routing.flags.map((flag) => `${kind}:${flag}`));
  }
  return { routing: { ...first, answeredBy, escalated, flags } };
}
