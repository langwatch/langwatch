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
  /** The text the decision legs judge: the chosen view, or the full text when it was not sent. */
  readonly text: string;
  /** The full text, which an escalation always judges: an unsure answer may turn on the trace. */
  readonly fullText: string;
  /** A partial view was planned but the caller did not render it, or rendered it empty. */
  readonly isViewMissing: boolean;
  /** The partial view asked for that the planned decision model may not judge, if any. */
  readonly refusedView?: InstantEvalJudgeInputView;
  /** The tools view asked for but rendered no shorter than the full trace, so not used. */
  readonly longerView?: InstantEvalJudgeInputView;
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
  const asked = instantEvalJudgeInputViewOf({ route, table });
  const fullPlan = () =>
    planForView({
      route: { ...route, tokens: undefined },
      text,
      questions,
      table,
      inputView: "full",
    });
  if (asked === "tools" && !isToolsViewShorter({ route, text })) {
    return { ...fullPlan(), longerView: asked };
  }
  const plan = planForView({ route, text, questions, table, inputView: asked });
  if (asked === "full" || isViewAllowed({ plan, table })) return plan;
  // A backend kind the table does not allow on the partial view gets the full one.
  return { ...fullPlan(), refusedView: asked };
}

/**
 * The tools view earns its place only by being shorter: a trace that is mostly tool calls renders
 * a tools view as long as the trace, which costs the same and drops the conversation around it.
 */
function isToolsViewShorter({ route, text }: { route: InstantEvalJudgeRoute; text: string }) {
  const tools = route.views?.tools;
  if (!tools?.trim()) return true;
  return estimateJudgedTextTokens({ text: tools }) < estimateJudgedTextTokens({ text });
}

function isViewAllowed({
  plan,
  table,
}: {
  plan: InstantEvalJudgeRoutePlan;
  table: InstantEvalJudgeRouteTable;
}): boolean {
  if (plan.inputView === "full") return true;
  const kinds: readonly string[] = table.inputViews.allowedKinds[plan.inputView];
  return [plan.primary, plan.pairWith]
    .filter((name): name is string => name !== undefined)
    .every((name) => kinds.includes(table.backends[name]?.kind ?? ""));
}

function planForView({
  route,
  text,
  questions,
  table,
  inputView,
}: {
  route: InstantEvalJudgeRoute;
  text: string;
  questions: readonly InstantEvalBooleanQuestion[];
  table: InstantEvalJudgeRouteTable;
  inputView: InstantEvalJudgeInputView;
}): InstantEvalJudgeRoutePlan {
  const rendered = inputView === "full" ? text : route.views?.[inputView];
  // An empty rendering (a trace of tool spans only) is no view: judging "" answers about nothing.
  const isViewMissing = inputView !== "full" && !rendered?.trim();
  const judged = isViewMissing || rendered === undefined ? text : rendered;
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
    fullText: text,
    isViewMissing,
    primary: entry.primary,
    ...(entry.pairWith ? { pairWith: entry.pairWith } : {}),
    ...(entry.escalateTo ? { escalateTo: entry.escalateTo } : {}),
    ...(entry.threshold === undefined ? {} : { threshold: entry.threshold }),
    fallbacks: fallbacksOf({ entry, table }),
  };
}

/** The call's own view, else the table's for its question category, else the table's default. */
function instantEvalJudgeInputViewOf({
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

/**
 * Whether a question asks for arithmetic, by the router's keyword rule. It fires on any digit,
 * so it flags many everyday checks; a caller's own flag wins where the table allows.
 */
const ARITHMETIC_PATTERN = new RegExp(
  [
    String.raw`\b(how many|count(s|ed|ing)?|total(s|led)?|sum|average|mean|percent(age)?`,
    String.raw`|more than \d|less than \d|at least \d|at most \d|number of|amount|price|cost`,
    String.raw`|refund|fee|charge|discount|balance|date|deadline|days?|weeks?|months?|hours?`,
    String.raw`|minutes?|before|after|within|late|early|calculat\w*|correct (figure|total|amount)`,
    String.raw`|exceed\w*)\b|[%€$£]|\d`,
  ].join(""),
  "i",
);

export function isArithmeticQuestion(instructions: string): boolean {
  return ARITHMETIC_PATTERN.test(instructions);
}
