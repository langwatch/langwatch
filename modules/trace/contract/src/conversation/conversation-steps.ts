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
}

/**
 * The detail levels a budgeted render tries in order. Tool results keep the
 * most at every level: that is where a long thread's evidence sits.
 */
export const CONVERSATION_DETAIL_LEVELS: readonly ConversationDetail[] = [
  {
    toolInputChars: 4_000,
    toolOutputChars: 16_000,
    proseChars: 2_000,
    turnTextChars: Number.POSITIVE_INFINITY,
    isNestedShown: true,
  },
  {
    toolInputChars: 1_200,
    toolOutputChars: 4_000,
    proseChars: 600,
    turnTextChars: 6_000,
    isNestedShown: true,
  },
  {
    toolInputChars: 400,
    toolOutputChars: 1_200,
    proseChars: 0,
    turnTextChars: 1_500,
    isNestedShown: true,
  },
  {
    toolInputChars: 200,
    toolOutputChars: 400,
    proseChars: 0,
    turnTextChars: 500,
    isNestedShown: true,
  },
  {
    toolInputChars: 120,
    toolOutputChars: 200,
    proseChars: 0,
    turnTextChars: 240,
    isNestedShown: false,
  },
];

export const FULL_CONVERSATION_DETAIL = CONVERSATION_DETAIL_LEVELS[0]!;

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
  const lines = steps.flatMap((step) => {
    if (step.depth > 0 && !detail.isNestedShown) return [];
    return [`${"  ".repeat(step.depth)}- ${renderStep({ step, detail })}`];
  });
  return lines.length > 0 ? ["**Steps:**", "", ...lines].join("\n") : "";
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
