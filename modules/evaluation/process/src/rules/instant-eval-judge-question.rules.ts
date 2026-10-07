/**
 * Turns an LLM judge's settings into one Instant Evals question and the text it reads (ADR-174
 * decisions 2 to 5), and maps a score answer back onto the judge's own range.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import type { Evaluators } from "@langwatch/evaluator-contract";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalClassifierLimits,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-contract";
import { cutToEstimatedTokensKeepingEnds } from "@langwatch/trace-contract";

/** The one question a judge call asks; its verdict is read back by this id. */
export const INSTANT_EVAL_JUDGE_QUESTION_ID = "judge";

/** What a boolean judge's two sides are, in that order: the prompt keeps its polarity. */
const BOOLEAN_CRITERIA = [
  "the instructions call for true",
  "the instructions call for false",
] as const;

/** The scale a range is asked on when it cannot be asked directly. */
const TEN_LEVELS = { min: 1, max: 10 } as const;

/** A score judge saved before the range setting existed reads as the default prompt's 0 to 1. */
const DEFAULT_SCORE_RANGE = { min: 0, max: 1 } as const;

type SettingsOf<T extends keyof Evaluators> = Evaluators[T]["settings"];

/**
 * The three LLM judges Instant Evals can answer, with the generated settings each one reads.
 * The score range is not in the generated settings yet; the range-setting step adds it there.
 */
export type InstantEvalJudge =
  | {
      readonly evaluatorType: "langevals/llm_boolean";
      readonly settings: Pick<SettingsOf<"langevals/llm_boolean">, "prompt">;
    }
  | {
      readonly evaluatorType: "langevals/llm_score";
      readonly settings: Pick<SettingsOf<"langevals/llm_score">, "prompt"> &
        InstantEvalJudgeScoreRange;
    }
  | {
      readonly evaluatorType: "langevals/llm_category";
      readonly settings: Pick<SettingsOf<"langevals/llm_category">, "prompt" | "categories">;
    };

/** What the judge's mappings resolved to for one trace. */
export interface InstantEvalJudgeInputs {
  readonly input?: string;
  readonly output?: string;
  readonly contexts?: readonly string[];
}

export type InstantEvalJudgeRequest =
  | { readonly kind: "ask"; readonly question: InstantEvalQuestion; readonly text: string }
  | { readonly kind: "nothing_to_judge" };

/** The score range a judge's settings name, with unset bounds read as 0 to 1. */
export interface InstantEvalJudgeScoreRange {
  readonly min?: number;
  readonly max?: number;
}

export function buildInstantEvalJudgeRequest({
  judge,
  inputs,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  judge: InstantEvalJudge;
  inputs: InstantEvalJudgeInputs;
  limits?: InstantEvalClassifierLimits;
}): InstantEvalJudgeRequest {
  const sections = sectionsOf(inputs);
  if (sections.length === 0) return { kind: "nothing_to_judge" };
  const question = questionOf(judge);
  const roomBytes = instantEvalJudgeTextRoomBytes({ question, limits });
  return { kind: "ask", question, text: fitSections({ sections, roomBytes }) };
}

/**
 * Bytes of text the question leaves room for, at the densest ratio the classifier channel fits
 * at, so the channel never cuts the joined text again and loses a section's end.
 */
export function instantEvalJudgeTextRoomBytes({
  question,
  limits = INSTANT_EVAL_CLASSIFIER_LIMITS,
}: {
  question: InstantEvalQuestion;
  limits?: InstantEvalClassifierLimits;
}): number {
  const questionTokens = Math.ceil(
    byteLength(JSON.stringify(question)) / limits.fitBytesPerInputToken,
  );
  const tokens = limits.stateTokens - limits.reserveTokens - questionTokens;
  return Math.max(0, Math.floor(tokens * limits.fitBytesPerInputToken));
}

/** A score answered on the scale it was asked, back on the judge's own range (decision 4). */
export function scoreOnJudgeRange({
  answer,
  range,
}: {
  answer: number;
  range: InstantEvalJudgeScoreRange;
}): number {
  const { min, max } = rangeOf(range);
  if (isAskedDirectly({ min, max })) return answer;
  const mapped =
    min + ((answer - TEN_LEVELS.min) / (TEN_LEVELS.max - TEN_LEVELS.min)) * (max - min);
  return isFractionScale({ min, max }) || !isWholeRange({ min, max }) ? mapped : Math.round(mapped);
}

function questionOf(judge: InstantEvalJudge): InstantEvalQuestion {
  const id = INSTANT_EVAL_JUDGE_QUESTION_ID;
  const instructions = judge.settings.prompt;
  switch (judge.evaluatorType) {
    case "langevals/llm_boolean":
      return { id, kind: "boolean", instructions, criteria: BOOLEAN_CRITERIA };
    case "langevals/llm_score":
      return { id, kind: "score", instructions, range: askedRangeOf(judge.settings) };
    case "langevals/llm_category":
      return { id, kind: "category", instructions, options: judge.settings.categories };
  }
}

function askedRangeOf(settings: InstantEvalJudgeScoreRange): { min: number; max: number } {
  const range = rangeOf(settings);
  return isAskedDirectly(range) ? range : { ...TEN_LEVELS };
}

function rangeOf(range: InstantEvalJudgeScoreRange): { min: number; max: number } {
  return { min: range.min ?? DEFAULT_SCORE_RANGE.min, max: range.max ?? DEFAULT_SCORE_RANGE.max };
}

/** Whole bounds, at most the classifier's ten levels, and not the 0 to 1 fraction scale. */
function isAskedDirectly(range: { min: number; max: number }): boolean {
  return (
    !isFractionScale(range) &&
    isWholeRange(range) &&
    range.max > range.min &&
    range.max - range.min + 1 <= INSTANT_EVAL_CLASSIFIER_LIMITS.maxScoreLevels
  );
}

function isFractionScale({ min, max }: { min: number; max: number }): boolean {
  return min === DEFAULT_SCORE_RANGE.min && max === DEFAULT_SCORE_RANGE.max;
}

function isWholeRange({ min, max }: { min: number; max: number }): boolean {
  return Number.isInteger(min) && Number.isInteger(max);
}

interface Section {
  readonly label: string;
  readonly body: string;
}

/** The labels langevals `build_content_parts` writes, so a prompt can still point at them. */
function sectionsOf({ input, output, contexts }: InstantEvalJudgeInputs): Section[] {
  const sections: Section[] = [];
  if (input?.trim()) sections.push({ label: "Input", body: input });
  if (output?.trim()) sections.push({ label: "Output", body: output });
  const kept = (contexts ?? []).filter((context) => context.trim());
  if (kept.length > 0) {
    sections.push({
      label: "Contexts",
      body: kept.map((context, index) => `${index + 1}. ${context}`).join("\n"),
    });
  }
  return sections;
}

const SECTION_SEPARATOR = "\n\n";

/**
 * Shares the room fairly, smallest section first: a section under its share stays whole and
 * leaves the rest to the others, so a long input never pushes out a short output.
 */
function fitSections({ sections, roomBytes }: { sections: Section[]; roomBytes: number }): string {
  const headers = sections.map(({ label }) => `# ${label}\n`);
  const overhead =
    headers.reduce((sum, header) => sum + byteLength(header), 0) +
    byteLength(SECTION_SEPARATOR) * (sections.length - 1);
  let remaining = Math.max(0, roomBytes - overhead);

  const bySize = sections
    .map((section, index) => ({ index, bytes: byteLength(section.body) }))
    .toSorted((a, b) => a.bytes - b.bytes);
  const allowance = new Map<number, number>();
  bySize.forEach(({ index, bytes }, position) => {
    const share = Math.floor(remaining / (bySize.length - position));
    const given = Math.min(bytes, share);
    allowance.set(index, given);
    remaining -= given;
  });

  return sections
    .map((section, index) => {
      const body = cutToEstimatedTokensKeepingEnds({
        text: section.body,
        maxTokens: allowance.get(index) ?? 0,
        bytesPerToken: 1,
      });
      return `${headers[index]}${body}`;
    })
    .join(SECTION_SEPARATOR);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
