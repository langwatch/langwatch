/**
 * The router's plan: one pure step from a routed call and the route table to the backends that
 * may answer it, before anything is spent. Input view first, then the length bucket of that
 * view, then arithmetic, then the mode with its fallback to cheaper modes.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  estimateJudgedTextTokens,
  instantEvalQuestionTokens,
  INSTANT_EVAL_JUDGE_ARITHMETIC_SLOT,
  INSTANT_EVAL_JUDGE_MODES,
  instantEvalJudgeEnabledFallbacksOf,
  instantEvalJudgeEntryBackends,
  isInstantEvalJudgeEntryEnabled,
  type InstantEvalJudgeInputView,
  type InstantEvalJudgeJob,
  type InstantEvalJudgeMode,
  type InstantEvalJudgeRouteRequest,
  type InstantEvalJudgeRouteEntry,
  type InstantEvalJudgeRouteSlot,
  type InstantEvalJudgeRouteTable,
  type InstantEvalQuestion,
  type InstantEvalQuestionKind,
  type InstantEvalSkipReason,
  type InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";

import type { InstantEvalPermit } from "../channels/instant-eval-classifier.channel.ts";
import { instantEvalVerdictSurenessOf } from "./instant-eval-judge-sureness.rules.ts";

export interface InstantEvalJudgeRoutePlan {
  readonly job: InstantEvalJudgeJob;
  /** The kind every question of the plan asks; one plan never mixes kinds. */
  readonly kind: InstantEvalQuestionKind;
  readonly modeRequested: InstantEvalJudgeMode;
  readonly mode: InstantEvalJudgeMode;
  readonly bucket: string;
  /** The bucket or the arithmetic slot; `default` when a score or category took its kind's. */
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

/**
 * The plan for one routed call. Its questions share one kind, and a score or category kind is
 * one the table routes; the caller checked both.
 */
export function instantEvalJudgeRoutePlanOf({
  route,
  text,
  questions,
  table,
  kind = "boolean",
}: {
  route: InstantEvalJudgeRouteRequest;
  text: string;
  questions: readonly InstantEvalQuestion[];
  table: InstantEvalJudgeRouteTable;
  kind?: InstantEvalQuestionKind;
}): InstantEvalJudgeRoutePlan {
  const asked = instantEvalJudgeInputViewOf({ route, table });
  const fullPlan = () =>
    planForView({
      route: { ...route, tokens: undefined },
      text,
      questions,
      table,
      kind,
      inputView: "full",
    });
  if (asked === "tools" && !isToolsViewShorter({ route, text })) {
    return { ...fullPlan(), longerView: asked };
  }
  const plan = planForView({ route, text, questions, table, kind, inputView: asked });
  if (asked === "full" || isViewAllowed({ plan, table })) return plan;
  // A backend kind the table does not allow on the partial view gets the full one.
  return { ...fullPlan(), refusedView: asked };
}

/**
 * The tools view earns its place only by being shorter: a trace that is mostly tool calls renders
 * a tools view as long as the trace, which costs the same and drops the conversation around it.
 */
function isToolsViewShorter({
  route,
  text,
}: {
  route: InstantEvalJudgeRouteRequest;
  text: string;
}) {
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
  kind,
  inputView,
}: {
  route: InstantEvalJudgeRouteRequest;
  text: string;
  questions: readonly InstantEvalQuestion[];
  table: InstantEvalJudgeRouteTable;
  kind: InstantEvalQuestionKind;
  inputView: InstantEvalJudgeInputView;
}): InstantEvalJudgeRoutePlan {
  const rendered = inputView === "full" ? text : route.views?.[inputView];
  // An empty rendering (a trace of tool spans only) is no view: judging "" answers about nothing.
  const isViewMissing = inputView !== "full" && !rendered?.trim();
  const judged = isViewMissing || rendered === undefined ? text : rendered;
  const tokens = route.tokens ?? estimateJudgedTextTokens({ text: judged });
  const bucket = bucketOf({ tokens, table });
  const arithmetic = isArithmeticCall({ route, questions, table });
  const wanted =
    arithmetic && tokens <= table.arithmetic.maxTokens
      ? INSTANT_EVAL_JUDGE_ARITHMETIC_SLOT
      : bucket;
  const modeRequested = route.mode ?? table.defaultMode[route.job];
  const { slot, routeSlot } = routeSlotOf({
    table,
    job: route.job,
    kind,
    wanted,
    bucket,
  });
  const { mode, entry } = usableEntryOf({ slot: routeSlot, requested: modeRequested, table });
  return {
    job: route.job,
    kind,
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
  route: InstantEvalJudgeRouteRequest;
  table: InstantEvalJudgeRouteTable;
}): InstantEvalJudgeInputView {
  if (route.inputView) return route.inputView;
  const byCategory = route.questionCategory
    ? table.inputViews.byCategory[route.questionCategory]
    : undefined;
  return byCategory ?? table.inputViews.default;
}

/**
 * A yes-or-no question's slot from the job's routes. A score or category question's from its
 * kind's routes: the job's slot, then (for an arithmetic call the kind does not route apart) the
 * length bucket's, then the kind's default.
 */
function routeSlotOf({
  table,
  job,
  kind,
  wanted,
  bucket,
}: {
  table: InstantEvalJudgeRouteTable;
  job: InstantEvalJudgeJob;
  kind: InstantEvalQuestionKind;
  wanted: string;
  bucket: string;
}): {
  slot: string;
  routeSlot: InstantEvalJudgeRouteSlot;
} {
  if (kind === "boolean") {
    const routeSlot = table.routes[job][wanted];
    if (!routeSlot) throw new Error(`the route table has no slot ${job} / ${wanted}`);
    return { slot: wanted, routeSlot };
  }
  const routing = table.kinds[kind];
  if (!routing) throw new Error(`the route table does not route ${kind} questions`);
  const routes = routing.routes[job] ?? {};
  for (const key of [wanted, bucket]) {
    const routeSlot = routes[key];
    if (routeSlot) return { slot: key, routeSlot };
  }
  return { slot: "default", routeSlot: routing.default };
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
  route: InstantEvalJudgeRouteRequest;
  questions: readonly InstantEvalQuestion[];
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
    if (entry && isInstantEvalJudgeEntryEnabled({ entry, table })) return { mode, entry };
  }
  return { mode: "instant", entry: slot.instant };
}

function fallbacksOf({
  entry,
  table,
}: {
  entry: InstantEvalJudgeRouteEntry;
  table: InstantEvalJudgeRouteTable;
}): Record<string, readonly string[]> {
  const fallbacks: Record<string, readonly string[]> = {};
  for (const backend of instantEvalJudgeEntryBackends(entry)) {
    fallbacks[backend] = instantEvalJudgeEnabledFallbacksOf({ backend, table });
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

function isArithmeticQuestion(instructions: string): boolean {
  return ARITHMETIC_PATTERN.test(instructions);
}

/** One question's answer from one backend, with how sure it is, from 0 to 1. */
export interface InstantEvalJudgeRoutedAnswer {
  readonly verdict: InstantEvalVerdict;
  readonly sureness: number;
  /** The fallback that supplied it, when not the leg's own backend. */
  readonly backend?: string;
}

/** The answer per question one backend gave, or why it could not. */
export type InstantEvalJudgeLeg =
  | Readonly<{
      outcome: "answered";
      backend: string;
      answers: ReadonlyMap<string, InstantEvalJudgeRoutedAnswer>;
      isTextTruncated: boolean;
      limiterWaitMs: number;
    }>
  | Readonly<{ outcome: "failed"; reason: InstantEvalSkipReason; error?: unknown }>;

export type InstantEvalJudgeAnsweredLeg = Extract<InstantEvalJudgeLeg, { outcome: "answered" }>;

/** A plan's first send: the primary's leg, and the partner's when the plan pairs. */
export type InstantEvalJudgeFirstLeg = Readonly<{
  primary: InstantEvalJudgeLeg;
  pairWith?: InstantEvalJudgeLeg;
}>;

/**
 * Each question's verdict from a decision model, with its sureness by its own kind's rule, so one
 * send may carry several kinds. A verdict without its kind's field (a probability, a score, a
 * label) is no answer.
 */
export function instantEvalDecisionAnswersOf({
  questions,
  judgement,
  table,
}: {
  questions: readonly InstantEvalQuestion[];
  judgement: { verdicts: readonly InstantEvalVerdict[] };
  table: InstantEvalJudgeRouteTable;
}): Map<string, InstantEvalJudgeRoutedAnswer> {
  const answers = new Map<string, InstantEvalJudgeRoutedAnswer>();
  for (const question of questions) {
    const verdict = judgement.verdicts.find((v) => v.questionId === question.id);
    if (!verdict || !answersItsKind({ question, verdict })) continue;
    const rule = question.kind === "boolean" ? undefined : table.kinds[question.kind]?.sureness;
    answers.set(question.id, {
      verdict,
      sureness: instantEvalVerdictSurenessOf({ question, verdict, rule }),
    });
  }
  return answers;
}

function answersItsKind({
  question,
  verdict,
}: {
  question: InstantEvalQuestion;
  verdict: InstantEvalVerdict;
}): boolean {
  if (question.kind === "boolean") return verdict.probability !== undefined;
  if (question.kind === "score") return verdict.score !== undefined;
  return verdict.label !== undefined;
}

export function isInstantEvalJudgeLegAnswered(
  leg: InstantEvalJudgeLeg,
): leg is InstantEvalJudgeAnsweredLeg {
  return leg.outcome === "answered";
}

/** A leg's answers with a fallback's for the questions it left, each naming its backend. */
export function instantEvalJudgeLegsJoined({
  first,
  next,
}: {
  first: InstantEvalJudgeAnsweredLeg | undefined;
  next: InstantEvalJudgeAnsweredLeg;
}): InstantEvalJudgeAnsweredLeg {
  if (!first) return next;
  const answers = new Map(first.answers);
  for (const [questionId, answer] of next.answers) {
    answers.set(questionId, { ...answer, backend: answer.backend ?? next.backend });
  }
  return {
    ...first,
    answers,
    isTextTruncated: first.isTextTruncated || next.isTextTruncated,
    limiterWaitMs: first.limiterWaitMs + next.limiterWaitMs,
  };
}

/** Per question the first leg (or `pick`) holding an answer supplies the verdict. */
export function instantEvalRoutedVerdictsOf({
  questions,
  legs,
  pick,
}: {
  questions: readonly InstantEvalQuestion[];
  legs: readonly InstantEvalJudgeAnsweredLeg[];
  pick?: ((questionId: string) => InstantEvalJudgeAnsweredLeg | undefined) | undefined;
}): {
  verdicts: InstantEvalVerdict[];
  answeredBy: Record<string, number>;
} {
  const answeredBy: Record<string, number> = {};
  const verdicts: InstantEvalVerdict[] = [];
  for (const question of questions) {
    const leg = pick?.(question.id) ?? legs.find((l) => l.answers.has(question.id));
    const answer = leg?.answers.get(question.id);
    if (!leg || !answer) continue;
    verdicts.push(answer.verdict);
    const backend = answer.backend ?? leg.backend;
    answeredBy[backend] = (answeredBy[backend] ?? 0) + 1;
  }
  return { verdicts, answeredBy };
}
/** One send's ask of the limiter: a tenant share per leg kind, under the shared global cap. */
export function instantEvalJudgeLegPermitOf({
  projectId,
  pool,
  text,
  questions,
}: {
  projectId: string;
  pool: "decisions" | "llm";
  text: string;
  questions: readonly InstantEvalQuestion[];
}): InstantEvalPermit {
  return {
    tokens: estimateJudgedTextTokens({ text }) + instantEvalQuestionTokens(questions),
    tenantId: `${projectId}:${pool}`,
  };
}

/** A leg's own timeout or the stop it caused, as the channels and the limiter throw it. */
export function isInstantEvalJudgeLegStop(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
