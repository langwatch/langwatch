/**
 * `eval:"question"`: traces an Instant Eval run judged as a match. The run is
 * not in the query text — the client sends it as `evalRuns` and the compiler
 * reads it off the context; a chip with no run compiles to no rows.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import type { InstantEvalTarget } from "@langwatch/instant-eval-contract";
import {
  type FieldDef,
  INSTANT_EVAL_TARGET_FIELDS,
  type ResolvedInstantEvalRun,
  type TranslationContext,
  UNSUPPORTED,
} from "@langwatch/trace-contract";

import { META_FIELD_DEFS } from "./trace-query-meta-fields.rules.ts";
import { instantEvalJudgmentsSubquery } from "./trace-query-subquery.rules.ts";
import {
  extractStringValue,
  nextParam,
  validateValueLength,
  wrap,
} from "./trace-query-values.rules.ts";

function normalise(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

/** The runs a chip names; empty when the client registered none for it. */
function findRuns({
  ctx,
  question,
  target,
}: {
  ctx: TranslationContext;
  question: string;
  target: InstantEvalTarget | undefined;
}): ResolvedInstantEvalRun[] {
  const wanted = normalise(question);

  return (
    ctx.evalRuns?.filter(
      (run) =>
        normalise(run.question) === wanted && (target === undefined || run.target === target),
    ) ?? []
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

/**
 * One eval field. The bare spelling keeps the meaning it had before Instant
 * Evals when nothing resolves — `eval:<name>` was the evaluator-name lookup,
 * and a saved query that spells it still is.
 */
function fieldDef(fieldName: string): FieldDef {
  const forced = INSTANT_EVAL_TARGET_FIELDS[fieldName];

  return {
    toClickHouse: (tag, negated, ctx) => {
      const question = extractStringValue(tag);
      validateValueLength(question);
      const [run] = findRuns({ ctx, question, target: forced });
      if (run) return compileRun({ ctx, run, negated });
      // A forcing spelling can only mean an Instant Eval, so with no run it
      // matches nothing; the bare field falls back to the evaluator lookup.
      if (forced) return wrap("1 = 0", negated);

      return META_FIELD_DEFS.eval.toClickHouse(tag, negated, ctx);
    },
    evaluateInMemory: forced ? () => UNSUPPORTED : META_FIELD_DEFS.eval.evaluateInMemory,
    ...(forced ? {} : { needs: "evaluations" as const }),
  };
}

export const INSTANT_EVAL_FIELD_DEFS = {
  eval: fieldDef("eval"),
  "eval.trace": fieldDef("eval.trace"),
  "eval.conversation": fieldDef("eval.conversation"),
  "eval.llm": fieldDef("eval.llm"),
} satisfies Record<string, FieldDef>;
