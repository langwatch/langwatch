/**
 * `eval:"question"`: traces an Instant Eval run judged as a match.
 *
 * The chip's value is the question. The run behind it is not in the query
 * text: the client sends it as `evalRuns`, resolved by the run service into
 * the run id and the window its judgements were written in, and the compiler
 * reads that resolution off the translation context. A chip whose question
 * and target resolve to no run compiles to no rows, so a table under a chip
 * that has no run yet is empty rather than wrong.
 *
 * The bare field keeps the meaning it had before Instant Evals when nothing
 * resolves: `eval:<name>` was the evaluator-name lookup, and a saved query
 * that spells it still is.
 *
 * @see ../query-language/instantEvalChips.ts: the spelling and the run key
 * @see ../../../../../../specs/traces-v2/instant-eval-search.feature
 */

import type { InstantEvalChipTarget } from "../query-language/instantEvalChips";
import { instantEvalTargetOfField } from "../query-language/instantEvalChips";
import { type FieldDef, UNSUPPORTED } from "./field-def";
import { META_FIELD_DEFS } from "./meta-handlers";
import { instantEvalJudgmentsSubquery } from "./subqueries";
import {
  extractStringValue,
  nextParam,
  type TranslationContext,
  validateValueLength,
  wrap,
} from "./value-helpers";

/** One run the client sent, checked against the project and dated. */
export interface ResolvedInstantEvalRun {
  readonly question: string;
  readonly target: InstantEvalChipTarget;
  readonly runId: string;
  /** When the run's judgements started being written, epoch milliseconds. */
  readonly writtenFrom: number;
  /** When the last of them could have been written, epoch milliseconds. */
  readonly writtenUntil: number;
}

function normalise(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

/** The run a chip names, or `null` when the client registered none for it. */
function resolveRun({
  ctx,
  question,
  target,
}: {
  ctx: TranslationContext;
  question: string;
  target: InstantEvalChipTarget | null;
}): ResolvedInstantEvalRun | null {
  const wanted = normalise(question);
  return (
    ctx.evalRuns?.find(
      (run) =>
        normalise(run.question) === wanted &&
        (target === null || run.target === target),
    ) ?? null
  );
}

function compileRun({
  ctx,
  run,
  negated,
}: {
  ctx: TranslationContext;
  run: ResolvedInstantEvalRun;
  negated: boolean;
}): string {
  const runParam = nextParam(ctx, "evalRun");
  const fromParam = nextParam(ctx, "evalWrittenFrom");
  const untilParam = nextParam(ctx, "evalWrittenUntil");
  ctx.params[runParam] = run.runId;
  ctx.params[fromParam] = run.writtenFrom;
  ctx.params[untilParam] = run.writtenUntil;
  return wrap(
    instantEvalJudgmentsSubquery({
      by: run.target === "threads" ? "conversation" : "trace",
      runParam,
      fromParam,
      untilParam,
    }),
    negated,
  );
}

function instantEvalFieldDef(fieldName: string): FieldDef {
  const forced = instantEvalTargetOfField(fieldName);
  return {
    toClickHouse: (tag, negated, ctx) => {
      const question = extractStringValue(tag);
      validateValueLength(question);
      const run = resolveRun({ ctx, question, target: forced });
      if (run) return compileRun({ ctx, run, negated });
      // No run for this chip. A forcing spelling can only mean an Instant
      // Eval, so it matches nothing; the bare field falls back to the
      // evaluator-name lookup it always was.
      if (forced) return wrap("1 = 0", negated);
      return META_FIELD_DEFS.eval.toClickHouse(tag, negated, ctx);
    },
    evaluateInMemory: forced
      ? () => UNSUPPORTED
      : META_FIELD_DEFS.eval.evaluateInMemory,
    ...(forced ? {} : { needs: "evaluations" as const }),
  };
}

export const INSTANT_EVAL_FIELD_DEFS = {
  eval: instantEvalFieldDef("eval"),
  "eval.trace": instantEvalFieldDef("eval.trace"),
  "eval.conversation": instantEvalFieldDef("eval.conversation"),
  "eval.llm": instantEvalFieldDef("eval.llm"),
} satisfies Record<string, FieldDef>;
