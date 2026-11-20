/**
 * The recall key of a kept Instant Evals result (ADR-189): which trace or span, which question,
 * which judged text, and which version of this hashing wrote it.
 * @see dev/docs/adr/189-instant-eval-result-storage.md
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import { createHash } from "node:crypto";

import type { InstantEvalMonitorJudgment } from "@langwatch/instant-eval-contract";
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";

import type { EvalResultsMatchKey } from "../repositories/eval-results.repository.ts";

import { instantEvalRowKeyOf } from "./instant-eval-row-keys.rules.ts";
import type { InstantEvalRunQuestion } from "./instant-eval-run-questions.rules.ts";

/**
 * The version of the hashing below. Recall reads only rows of this version, so a bump is only
 * for a key bug: it retires every row written under the old one.
 */
export const EVAL_RESULTS_KEY_VERSION = 1;

/** The judged column a monitor's row names: it judges a mapping, not one extracted column. */
export const EVAL_RESULTS_MONITOR_JUDGED_COLUMN = "monitor";

/** Where one judged cell's result is kept, and when its trace happened. */
export interface EvalResultsCellKey extends EvalResultsMatchKey {
  /** The extraction that produced the text, e.g. `llm_readable_trace`. */
  readonly judgedColumn: string;
  /** Epoch milliseconds: the partition and the retention anchor. */
  readonly occurredAt: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Spacing is not meaning: two runs of spaces ask the judge the same thing. */
function normalised(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** What a question asks, without the column alias it was asked under. */
function askedOf(question: InstantEvalQuestion): readonly unknown[] {
  const instructions = normalised(question.instructions);
  if (question.kind === "score") {
    return ["score", instructions, [question.range.min, question.range.max]];
  }
  if (question.kind === "category") {
    const options = question.options.map((option) => [
      normalised(option.name),
      normalised(option.description),
    ]);
    return ["category", instructions, options];
  }
  const criteria = question.criteria ? question.criteria.map(normalised) : null;
  return ["boolean", instructions, criteria];
}

/** sha256 of the normalised kind, text, criteria, range and categories. */
export function evalResultsQuestionHash(question: InstantEvalQuestion): string {
  return sha256(JSON.stringify(askedOf(question)));
}

/** sha256 of the judged column's name and its text; the text itself is never kept. */
export function evalResultsInputHash({
  judgedColumn,
  text,
}: {
  judgedColumn: string;
  text: string;
}): string {
  return sha256(JSON.stringify([judgedColumn, text]));
}

/**
 * The key one row's answer to one question is kept under; empty when it is not kept: a thread's
 * or a literal text, a row naming no trace (or no span for a span's text), or no trace time.
 */
export function findEvalResultsCellKeys({
  row,
  question,
  text,
}: {
  row: Record<string, unknown>;
  question: InstantEvalRunQuestion;
  text: string;
}): readonly EvalResultsCellKey[] {
  const { judgedText } = question;
  if (!judgedText || text === "") return [];
  const { traceId, spanId, occurredAt } = instantEvalRowKeyOf(row);
  const isSpan = judgedText.keyKind === "span";
  if (traceId === "" || occurredAt === null || (isSpan && spanId === "")) return [];

  return [
    {
      traceId,
      spanId: isSpan ? spanId : "",
      questionHash: evalResultsQuestionHash(question.question),
      inputHash: evalResultsInputHash({ judgedColumn: judgedText.function, text }),
      judgedColumn: judgedText.function,
      occurredAt,
    },
  ];
}

/**
 * A monitor's judgment key (ADR-189 section 5): the trace alone, and a hash of its mapped input,
 * output and contexts as canonical JSON, so a monitor's rows and an ask's never recall each other.
 */
export function evalResultsMonitorCellKey(
  judgment: Pick<InstantEvalMonitorJudgment, "traceId" | "occurredAt" | "question" | "inputs">,
): EvalResultsCellKey {
  const { input, output, contexts } = judgment.inputs;
  // Fixed key order and an absent field as null, so the same mapping always hashes the same.
  const canonical = JSON.stringify({
    contexts: contexts ?? [],
    input: input ?? null,
    output: output ?? null,
  });
  return {
    traceId: judgment.traceId,
    spanId: "",
    questionHash: evalResultsQuestionHash(judgment.question),
    inputHash: sha256(canonical),
    judgedColumn: EVAL_RESULTS_MONITOR_JUDGED_COLUMN,
    occurredAt: judgment.occurredAt,
  };
}

/**
 * The model a row records and recall keys on: the own decision model's id, or LangWatch's judge.
 * A judge that changes its weights must change this id, or recall serves its old verdicts.
 */
export function evalResultsJudgeModelOf(
  resolution:
    | Readonly<{ kind: "langwatch" }>
    | Readonly<{ kind: "own" | "own_unavailable"; model: string }>,
): string {
  return resolution.kind === "langwatch" ? INSTANT_EVAL_JUDGE_MODEL_ID : resolution.model;
}

/** One key as a single map key. JSON, so no id holding a separator can collide. */
export function evalResultsMatchKeyId(key: EvalResultsMatchKey): string {
  return JSON.stringify([key.traceId, key.spanId, key.questionHash, key.inputHash]);
}
