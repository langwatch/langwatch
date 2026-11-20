/**
 * `eval:"question"`: traces an Instant Eval run judged as a match. The run is not in the query
 * text: the client sends it as `evalRuns` and the compiler reads it off the context; a chip with
 * no run compiles to no rows, negated or not. Under NOT, it keeps the judged "no" traces only.
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
import { instantEvalJudgmentsSubquery, wrapMembership } from "./trace-query-subquery.rules.ts";
import { extractStringValue, nextParam, validateValueLength } from "./trace-query-values.rules.ts";

function normalise(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

/**
 * The runs a chip names; empty when the client registered none for it. A NOT reaching this
 * occurrence across an OR leaves it no run either, while a same-question sibling keeps it.
 */
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

  const membership = (verdict: "passed" | "not_passed") =>
    instantEvalJudgmentsSubquery({
      by: run.target === "threads" ? "conversation" : "trace",
      runParam,
      fromParam,
      untilParam,
      verdict,
    });
  if (!negated) return membership("passed");
  // NOT keeps only rows the run judged and did not pass: a row past the cap, after a stop
  // or newer than the run was never judged, so it is no non-match either. A threads run's
  // row is a conversation: one judged "no" keeps every turn, as a matched one does.
  return `(${membership("not_passed")} AND ${wrapMembership(membership("passed"), true)})`;
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
      const unjudgeable = ctx.unjudgeableEvalTags?.has(tag) ?? false;
      if (run && !unjudgeable) return compileRun({ ctx, run, negated });
      // A known Instant Eval chip with no usable run matches nothing, under NOT too: no
      // reader may list rows no run judged. Only a bare chip no run names stays the lookup.
      if (forced || run) return "1 = 0";

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
