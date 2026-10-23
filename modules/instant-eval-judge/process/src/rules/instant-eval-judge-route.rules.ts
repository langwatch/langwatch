/**
 * The router's plan: one pure step from a routed call and the route table to the backends that
 * may answer it, before anything is spent. Input view first, then the length bucket of that
 * view, then arithmetic, then the mode with its fallback to cheaper modes.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  estimateJudgedTextTokens,
  INSTANT_EVAL_JUDGE_ARITHMETIC_SLOT,
  INSTANT_EVAL_JUDGE_MODES,
  instantEvalJudgeEntryBackends,
  type InstantEvalBooleanQuestion,
  type InstantEvalJudgeInputView,
  type InstantEvalJudgeJob,
  type InstantEvalJudgeMode,
  type InstantEvalJudgeRoute,
  type InstantEvalJudgeRouteEntry,
  type InstantEvalJudgeRouteSlot,
  type InstantEvalJudgeRouteTable,
} from "@langwatch/instant-eval-judge-contract";

import { isArithmeticQuestion } from "./instant-eval-judge-arithmetic.rules.ts";

export interface InstantEvalJudgeRoutePlan {
  readonly job: InstantEvalJudgeJob;
  readonly modeRequested: InstantEvalJudgeMode;
  readonly mode: InstantEvalJudgeMode;
  readonly bucket: string;
  /** The bucket, or the arithmetic slot. */
  readonly slot: string;
  readonly tokens: number;
  readonly arithmetic: boolean;
  readonly inputView: InstantEvalJudgeInputView;
  /** The text the legs judge: the view the plan chose, or the full text when it is missing. */
  readonly text: string;
  readonly isTextViewMissing: boolean;
  readonly primary: string;
  readonly pairWith?: string;
  readonly escalateTo?: string;
  readonly threshold?: number;
  /** Each planned backend's enabled fallbacks, in order. */
  readonly fallbacks: Readonly<Record<string, readonly string[]>>;
}

/** The plan for one routed call. Its questions are yes-or-no; the caller checked. */
export function instantEvalJudgeRoutePlanOf({
  route,
  text,
  questions,
  table,
}: {
  route: InstantEvalJudgeRoute;
  text: string;
  questions: readonly InstantEvalBooleanQuestion[];
  table: InstantEvalJudgeRouteTable;
}): InstantEvalJudgeRoutePlan {
  const inputView = instantEvalJudgeInputViewOf({ route, table });
  const isTextViewMissing = inputView === "text" && route.textView === undefined;
  const judged = inputView === "text" && route.textView !== undefined ? route.textView : text;
  const tokens = route.tokens ?? estimateJudgedTextTokens({ text: judged });
  const bucket = bucketOf({ tokens, table });
  const arithmetic = isArithmeticCall({ route, questions, table });
  const slot =
    arithmetic && tokens <= table.arithmetic.maxTokens
      ? INSTANT_EVAL_JUDGE_ARITHMETIC_SLOT
      : bucket;
  const modeRequested = route.mode ?? table.defaultMode[route.job];
  const routeSlot = table.routes[route.job][slot];
  if (!routeSlot) throw new Error(`the route table has no slot ${route.job} / ${slot}`);
  const { mode, entry } = usableEntryOf({ slot: routeSlot, requested: modeRequested, table });
  return {
    job: route.job,
    modeRequested,
    mode,
    bucket,
    slot,
    tokens,
    arithmetic,
    inputView,
    text: judged,
    isTextViewMissing,
    primary: entry.primary,
    ...(entry.pairWith ? { pairWith: entry.pairWith } : {}),
    ...(entry.escalateTo ? { escalateTo: entry.escalateTo } : {}),
    ...(entry.threshold === undefined ? {} : { threshold: entry.threshold }),
    fallbacks: fallbacksOf({ entry, table }),
  };
}

/** The call's own view, else the table's for its question category, else the table's default. */
export function instantEvalJudgeInputViewOf({
  route,
  table,
}: {
  route: InstantEvalJudgeRoute;
  table: InstantEvalJudgeRouteTable;
}): InstantEvalJudgeInputView {
  if (route.inputView) return route.inputView;
  const byCategory = route.questionCategory
    ? table.inputViews.byCategory[route.questionCategory]
    : undefined;
  return byCategory ?? table.inputViews.default;
}

/** Unsure when |2p - 1| is below the threshold; no probability is always unsure. */
export function isUnsureVerdict({
  probability,
  threshold,
}: {
  probability: number | undefined;
  threshold: number;
}): boolean {
  return probability === undefined || Math.abs(2 * probability - 1) < threshold;
}

/** How far an answer is from a coin toss; -1 for no answer, so any answer beats none. */
export function instantEvalVerdictConfidence(probability: number | undefined): number {
  return probability === undefined ? -1 : Math.abs(2 * probability - 1);
}

function bucketOf({ tokens, table }: { tokens: number; table: InstantEvalJudgeRouteTable }) {
  const bucket = table.buckets.find((b) => b.maxTokens === null || tokens <= b.maxTokens);
  if (!bucket) throw new Error("the route table's last bucket must be open");
  return bucket.name;
}

function isArithmeticCall({
  route,
  questions,
  table,
}: {
  route: InstantEvalJudgeRoute;
  questions: readonly InstantEvalBooleanQuestion[];
  table: InstantEvalJudgeRouteTable;
}): boolean {
  const source = table.arithmetic.source[route.job];
  if (source !== "regex" && route.arithmetic !== undefined) return route.arithmetic;
  if (source === "request") return false;
  return questions.some((question) => isArithmeticQuestion(question.instructions));
}

/** The requested mode's entry, else the next cheaper mode's; instant always answers. */
function usableEntryOf({
  slot,
  requested,
  table,
}: {
  slot: InstantEvalJudgeRouteSlot;
  requested: InstantEvalJudgeMode;
  table: InstantEvalJudgeRouteTable;
}): { mode: InstantEvalJudgeMode; entry: InstantEvalJudgeRouteEntry } {
  for (let at = INSTANT_EVAL_JUDGE_MODES.indexOf(requested); at > 0; at--) {
    const mode = INSTANT_EVAL_JUDGE_MODES[at]!;
    const entry = slot[mode];
    if (entry && isEntryEnabled({ entry, table })) return { mode, entry };
  }
  return { mode: "instant", entry: slot.instant };
}

function isEntryEnabled({
  entry,
  table,
}: {
  entry: InstantEvalJudgeRouteEntry;
  table: InstantEvalJudgeRouteTable;
}): boolean {
  return instantEvalJudgeEntryBackends(entry).every((name) => table.backends[name]?.enabled);
}

function fallbacksOf({
  entry,
  table,
}: {
  entry: InstantEvalJudgeRouteEntry;
  table: InstantEvalJudgeRouteTable;
}): Record<string, readonly string[]> {
  const fallbacks: Record<string, readonly string[]> = {};
  for (const name of instantEvalJudgeEntryBackends(entry)) {
    fallbacks[name] = (table.backends[name]?.fallbacks ?? []).filter(
      (fallback) => table.backends[fallback]?.enabled,
    );
  }
  return fallbacks;
}
