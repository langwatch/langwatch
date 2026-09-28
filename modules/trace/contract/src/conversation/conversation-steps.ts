/**
 * The steps of a conversation turn, one compact line each. A model call's
 * history is never printed, so a thread renders each turn once.
 * @see specs/traces/trace-extraction-modules.feature
 */

import { isoTimestamp } from "../trace-time-format.ts";

export type ConversationStepKind = "model" | "tool" | "retrieval" | "span";

/** Token counts a model call reported; each only when it reported it. */
export interface ConversationStepUsage {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
}

export interface ConversationStep {
  kind: ConversationStepKind;
  /** Epoch ms the step started. */
  startedAt: number;
  /** The tool, the model, or the span name. */
  name: string;
  /** 0 directly under the turn, 1 inside a tool call. */
  depth: number;
  input?: string;
  output?: string;
  /** The tools a model call asked for, in order. */
  calls?: string[];
  usage?: ConversationStepUsage;
  error?: string;
}

/** How much of each value a render keeps; a budget walks down the levels. */
export interface ConversationDetail {
  toolInputChars: number;
  toolOutputChars: number;
  proseChars: number;
  turnTextChars: number;
  isNestedShown: boolean;
  /** Steps kept per turn; the rest are elided from its middle, model calls first. */
  maxStepsPerTurn: number;
}

/** Everything, each value capped at a size no judge needs more of. */
export const FULL_CONVERSATION_DETAIL: ConversationDetail = {
  toolInputChars: 4_000,
  toolOutputChars: 16_000,
  proseChars: 2_000,
  turnTextChars: Number.POSITIVE_INFINITY,
  isNestedShown: true,
  maxStepsPerTurn: Number.POSITIVE_INFINITY,
};

/** The smallest value caps a budgeted render goes down to before it elides steps. */
const MIN_CAPS = { toolInputChars: 120, toolOutputChars: 160, turnTextChars: 240 };

/**
 * Every cap scaled by `scale` in (0, 1], never below the floors. Tool results
 * keep the most at every scale: that is where a long thread's evidence sits.
 */
export function conversationDetailAtScale(scale: number): ConversationDetail {
  const at = (full: number, floor: number) => Math.max(floor, Math.floor(full * scale));
  return {
    toolInputChars: at(FULL_CONVERSATION_DETAIL.toolInputChars, MIN_CAPS.toolInputChars),
    toolOutputChars: at(FULL_CONVERSATION_DETAIL.toolOutputChars, MIN_CAPS.toolOutputChars),
    proseChars: scale >= 0.1 ? Math.floor(FULL_CONVERSATION_DETAIL.proseChars * scale) : 0,
    turnTextChars: at(12_000, MIN_CAPS.turnTextChars),
    isNestedShown: scale >= 0.02,
    maxStepsPerTurn: Number.POSITIVE_INFINITY,
  };
}

/** A value cut to `maxChars`, keeping its opening and its ending. */
export function clipKeepingEnds({ text, maxChars }: { text: string; maxChars: number }): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 0) return "";
  const headLength = safeIndex({ text, index: Math.ceil(maxChars * 0.65) });
  const tailStart = safeIndex({ text, index: text.length - Math.floor(maxChars * 0.35) });
  const omitted = tailStart - headLength;
  return `${text.slice(0, headLength)} […${omitted} chars…] ${text.slice(tailStart)}`;
}

/** An index moved off the low half of a surrogate pair. */
function safeIndex({ text, index }: { text: string; index: number }): number {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff ? index + 1 : index;
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The step list of one turn as markdown, empty when nothing is worth listing. */
export function renderConversationSteps({
  steps,
  detail,
}: {
  steps: readonly ConversationStep[];
  detail: ConversationDetail;
}): string {
  const shown = steps.filter((step) => step.depth === 0 || detail.isNestedShown);
  const kept = keepSteps({ steps: shown, max: detail.maxStepsPerTurn });
  const quietModels = kept.flatMap((entry) =>
    "omitted" in entry && entry.omitted.every((step) => step.kind === "model") ? entry.omitted : [],
  );
  const lines = kept.flatMap((entry) => {
    if (!("omitted" in entry)) {
      return [`${"  ".repeat(entry.step.depth)}- ${renderStep({ step: entry.step, detail })}`];
    }
    return entry.omitted.every((step) => step.kind === "model")
      ? []
      : [`- […${omittedText(entry.omitted)} omitted…]`];
  });
  if (quietModels.length > 0) {
    lines.unshift(`- […${omittedText(quietModels)} omitted${usageRange(quietModels)}…]`);
  }
  return lines.length > 0 ? ["**Steps:**", "", ...lines].join("\n") : "";
}

type KeptStep = { step: ConversationStep } | { omitted: ConversationStep[] };

/**
 * At most `max` steps, the dropped ones taken from the middle of the turn and
 * model calls before anything else: a tool line already names the tool the
 * model asked for, and the turn's first and last steps frame what it did.
 */
function keepSteps({ steps, max }: { steps: ConversationStep[]; max: number }): KeptStep[] {
  if (steps.length <= max) return steps.map((step) => ({ step }));
  const outliers = usageOutliers(steps);
  const keepFirst = (step: ConversationStep) => {
    if (outliers.has(step)) return 2;
    return step.kind === "model" ? 0 : 1;
  };
  const middleOut = steps
    .map((step, index) => ({ step, index, distance: Math.abs(index - (steps.length - 1) * 0.4) }))
    .toSorted((a, b) => keepFirst(a.step) - keepFirst(b.step) || a.distance - b.distance);
  const dropped = new Set(middleOut.slice(0, steps.length - max).map(({ index }) => index));
  const kept: KeptStep[] = [];
  let run: ConversationStep[] = [];
  steps.forEach((step, index) => {
    if (dropped.has(index)) {
      run.push(step);
      return;
    }
    if (run.length > 0) kept.push({ omitted: run });
    run = [];
    kept.push({ step });
  });
  if (run.length > 0) kept.push({ omitted: run });
  return kept;
}

/** The calls with the largest context and the smallest cache read: what usage questions ask. */
function usageOutliers(steps: ConversationStep[]): Set<ConversationStep> {
  const counted = steps.filter((step) => step.kind === "model" && step.usage);
  const context = (step: ConversationStep) =>
    (step.usage?.input ?? 0) + (step.usage?.cacheRead ?? 0) + (step.usage?.cacheWrite ?? 0);
  const largest = counted.toSorted((a, b) => context(b) - context(a))[0];
  const coldest = counted
    .filter((step) => step.usage?.cacheRead !== undefined)
    .toSorted((a, b) => (a.usage?.cacheRead ?? 0) - (b.usage?.cacheRead ?? 0))[0];
  return new Set([largest, coldest].filter((step): step is ConversationStep => step !== undefined));
}

/** What the omitted model calls carried, so a question about context size still has an answer. */
function usageRange(steps: ConversationStep[]): string {
  const contexts = steps.flatMap((step) =>
    step.usage
      ? [(step.usage.input ?? 0) + (step.usage.cacheRead ?? 0) + (step.usage.cacheWrite ?? 0)]
      : [],
  );
  if (contexts.length === 0) return "";
  const cacheReads = steps.flatMap((step) =>
    step.usage?.cacheRead !== undefined ? [step.usage.cacheRead] : [],
  );
  const cache =
    cacheReads.length > 0
      ? `, cache read ${Math.min(...cacheReads)} to ${Math.max(...cacheReads)}`
      : "";
  return `: context ${Math.min(...contexts)} to ${Math.max(...contexts)} tokens${cache}`;
}

function omittedText(steps: ConversationStep[]): string {
  const models = steps.filter((step) => step.kind === "model").length;
  const others = steps.length - models;
  return [
    models > 0 ? `${models} model call${models === 1 ? "" : "s"}` : "",
    others > 0 ? `${others} other step${others === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function renderStep({
  step,
  detail,
}: {
  step: ConversationStep;
  detail: ConversationDetail;
}): string {
  const time = clockTime(step.startedAt);
  const error = step.error
    ? ` ERROR ${oneLine(clipKeepingEnds({ text: step.error, maxChars: detail.toolInputChars }))}`
    : "";
  if (step.kind === "model") {
    const usage = step.usage ? usageText(step.usage) : "";
    const calls = step.calls && step.calls.length > 0 ? ` → ${step.calls.join(", ")}` : "";
    const prose =
      step.output && detail.proseChars > 0
        ? `: ${oneLine(clipKeepingEnds({ text: step.output, maxChars: detail.proseChars }))}`
        : "";
    return `${time} model ${step.name}${usage}${calls}${prose}${error}`;
  }
  const input = oneLine(
    clipKeepingEnds({ text: step.input ?? "", maxChars: detail.toolInputChars }),
  );
  const output = oneLine(
    clipKeepingEnds({ text: step.output ?? "", maxChars: detail.toolOutputChars }),
  );
  const label = step.kind === "span" ? "span" : step.kind;
  return `${time} ${label} ${step.name}(${input})${output ? ` → ${output}` : ""}${error}`;
}

function usageText(usage: ConversationStepUsage): string {
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : null,
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : null,
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : null,
    usage.output !== undefined ? `out ${usage.output}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** `HH:MM:SS` in UTC; the turn heading carries the date. */
function clockTime(epochMs: number): string {
  return isoTimestamp(epochMs).slice(11, 19);
}
