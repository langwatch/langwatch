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

function normalise(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

/** The runs a chip names; empty when the client registered none for it. */
export function findRuns({
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

/**
 * One eval field. The bare spelling keeps the meaning it had before Instant
 * Evals when nothing resolves — `eval:<name>` was the evaluator-name lookup,
 * and a saved query that spells it still is.
 */
function fieldDef(fieldName: string): FieldDef {
  const forced = INSTANT_EVAL_TARGET_FIELDS[fieldName];

  return {
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
