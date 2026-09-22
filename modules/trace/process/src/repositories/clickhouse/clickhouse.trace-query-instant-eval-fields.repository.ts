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

import { META_FIELD_DEFS } from "./clickhouse.trace-query-meta-fields.repository.ts";
import { ClickHouseTraceQuerySubqueryRepository } from "./clickhouse.trace-query-subquery.repository.ts";
import { ClickHouseTraceQueryValuesRepository } from "./clickhouse.trace-query-values.repository.ts";

const subqueries = ClickHouseTraceQuerySubqueryRepository.create();
const values = ClickHouseTraceQueryValuesRepository.create();

function normalise(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

export class ClickHouseTraceQueryInstantEvalFieldsRepository {
  private constructor() {}

  static create(): ClickHouseTraceQueryInstantEvalFieldsRepository {
    return new ClickHouseTraceQueryInstantEvalFieldsRepository();
  }

  /** The run a chip names, or `null` when the client registered none for it. */
  private resolveRun({
    ctx,
    question,
    target,
  }: {
    ctx: TranslationContext;
    question: string;
    target: InstantEvalTarget | undefined;
  }): ResolvedInstantEvalRun | null {
    const wanted = normalise(question);

    return (
      ctx.evalRuns?.find(
        (run) =>
          normalise(run.question) === wanted && (target === undefined || run.target === target),
      ) ?? null
    );
  }

  private compileRun({
    ctx,
    run,
    negated,
  }: {
    ctx: TranslationContext;
    run: ResolvedInstantEvalRun;
    negated: boolean;
  }): string {
    const runParam = values.nextParam(ctx, "evalRun");
    const fromParam = values.nextParam(ctx, "evalWrittenFrom");
    const untilParam = values.nextParam(ctx, "evalWrittenUntil");
    ctx.params[runParam] = run.runId;
    ctx.params[fromParam] = run.writtenFrom;
    ctx.params[untilParam] = run.writtenUntil;

    return values.wrap(
      subqueries.instantEvalJudgmentsSubquery({
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
  fieldDef(fieldName: string): FieldDef {
    const forced = INSTANT_EVAL_TARGET_FIELDS[fieldName];

    return {
      toClickHouse: (tag, negated, ctx) => {
        const question = values.extractStringValue(tag);
        values.validateValueLength(question);
        const run = this.resolveRun({ ctx, question, target: forced });
        if (run) return this.compileRun({ ctx, run, negated });
        // A forcing spelling can only mean an Instant Eval, so with no run it
        // matches nothing; the bare field falls back to the evaluator lookup.
        if (forced) return values.wrap("1 = 0", negated);

        return META_FIELD_DEFS.eval.toClickHouse(tag, negated, ctx);
      },
      evaluateInMemory: forced ? () => UNSUPPORTED : META_FIELD_DEFS.eval.evaluateInMemory,
      ...(forced ? {} : { needs: "evaluations" as const }),
    };
  }
}

const instantEvalFields = ClickHouseTraceQueryInstantEvalFieldsRepository.create();

export const INSTANT_EVAL_FIELD_DEFS = {
  eval: instantEvalFields.fieldDef("eval"),
  "eval.trace": instantEvalFields.fieldDef("eval.trace"),
  "eval.conversation": instantEvalFields.fieldDef("eval.conversation"),
  "eval.llm": instantEvalFields.fieldDef("eval.llm"),
} satisfies Record<string, FieldDef>;
