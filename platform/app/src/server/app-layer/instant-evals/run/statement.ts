/**
 * Whether a statement can be a run, decided before anything is spent.
 *
 * Three gates, in an order that matters:
 *
 *  1. **The reserved names**, first, because the run's own wrapper binds them
 *     and a statement that declares one would be paged by a value it wrote.
 *  2. **The query policy**, through the same validator the synchronous endpoint
 *     uses, so a statement a run accepts is one a query would have accepted. Its
 *     refusal is re-raised under the run's own code with the policy's own
 *     violations carried, so an agent still learns which clause to change.
 *  3. **The projection**, on a `LIMIT 0` probe. A run has to tie every
 *     judgement back to a trace and has to have something to judge, and neither
 *     is knowable from the text alone: a column list is the database's answer.
 *
 * The probe reads no rows on purpose. A `LIMIT 1` would answer the same
 * question and make one classification for a run that has not been accepted.
 *
 * @see ./composition.ts: the wrapper whose parameters are reserved
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { HandledError } from "@langwatch/handled-error";

import {
  isLangWatchQLSurfaceParameter,
  type LangWatchQLAppFunctionCall,
  type LangWatchQLColumn,
  type LangWatchQLService,
  lwqlAppFunction,
} from "~/server/analytics/lwql";
import type { Protections } from "~/server/traces/protections";
import {
  INSTANT_EVAL_RESERVED_PARAMETERS,
  INSTANT_EVAL_TRACE_COLUMN,
  isInstantEvalReservedParameter,
} from "./composition";
import {
  InstantEvalQueryInvalidError,
  InstantEvalQueryMissingColumnsError,
} from "./errors";
import {
  type InstantEvalRunQuestion,
  instantEvalRunQuestions,
} from "./questions";
import {
  type InstantEvalRowSource,
  type InstantEvalRunCaller,
  instantEvalKeyColumns,
} from "./row-source";

/** A statement that can be a run, with everything the run needs from it. */
export interface AcceptedInstantEvalStatement {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly questions: readonly InstantEvalRunQuestion[];
  /** The validator's hydration plan, stored on the run and read back per page. */
  readonly plan: readonly LangWatchQLAppFunctionCall[];
  /** The optional key columns the statement projects. */
  readonly keyColumns: readonly string[];
  readonly columns: readonly LangWatchQLColumn[];
}

/** Whichever run-owned parameter names the caller or the statement named. */
function reservedNamesIn({
  declared,
  supplied,
}: {
  readonly declared: readonly string[];
  readonly supplied: readonly string[];
}): readonly string[] {
  return [
    ...new Set(
      [...declared, ...supplied].filter((name) =>
        isInstantEvalReservedParameter(name),
      ),
    ),
  ].sort();
}

function refuseReservedParameters(names: readonly string[]): never {
  throw new InstantEvalQueryInvalidError({
    reason: `An Instant Eval run binds ${INSTANT_EVAL_RESERVED_PARAMETERS.join(" and ")} itself, so a statement cannot use them.`,
    parameters: names,
  });
}

/**
 * The statement's declared parameters a job has no way to fill.
 *
 * The dashboard's period and step are set by whichever surface is showing a
 * chart, and a job has no surface. Refused rather than defaulted, because
 * choosing a period on the caller's behalf would answer a different question
 * than the one they wrote.
 */
function refuseSurfaceParameters(names: readonly string[]): never {
  throw new InstantEvalQueryInvalidError({
    reason:
      "This statement declares the dashboard's own period parameters, which a job has no surface to fill. Write the period into its WHERE clause instead.",
    parameters: names,
  });
}

/** The columns a run needs that the statement does not project. */
function missingColumnsIn(columns: readonly LangWatchQLColumn[]): string[] {
  const present = new Set(columns.map((column) => column.name));
  return present.has(INSTANT_EVAL_TRACE_COLUMN)
    ? []
    : [INSTANT_EVAL_TRACE_COLUMN];
}

/** Whether the hydration plan judges anything at all. */
function judgesSomething(plan: readonly LangWatchQLAppFunctionCall[]): boolean {
  return plan.some((call) => lwqlAppFunction(call.function)?.kind === "eval");
}

export async function acceptInstantEvalStatement({
  query,
  rowSource,
  caller,
  protections,
  sql,
  parameters,
}: {
  readonly query: LangWatchQLService;
  readonly rowSource: InstantEvalRowSource;
  readonly caller: InstantEvalRunCaller;
  readonly protections: Protections;
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}): Promise<AcceptedInstantEvalStatement> {
  const supplied = Object.keys(parameters ?? {});
  const suppliedReserved = reservedNamesIn({ declared: [], supplied });
  if (suppliedReserved.length > 0) refuseReservedParameters(suppliedReserved);

  const validated = (() => {
    try {
      return query.validate({
        projectId: caller.id,
        protections,
        sql,
        ...(parameters ? { parameters } : {}),
        // A run only exists because the project may judge, and the service
        // checked that before it got here.
        instantEvalsEnabled: true,
      });
    } catch (error) {
      if (!(error instanceof HandledError)) throw error;
      // Re-raised under the run's code so the family answers one code for
      // "this statement cannot be a run", with the policy's own violations
      // carried so the caller still learns which clause to change.
      throw new InstantEvalQueryInvalidError({
        reason: error.message,
        violations: error.meta.violations,
        reasons: [error],
      });
    }
  })();

  const declaredReserved = reservedNamesIn({
    declared: validated.parameters.map((parameter) => parameter.name),
    supplied: [],
  });
  if (declaredReserved.length > 0) refuseReservedParameters(declaredReserved);

  const surfaceOwned = validated.parameters
    .map((parameter) => parameter.name)
    .filter((name) => isLangWatchQLSurfaceParameter(name))
    .sort();
  if (surfaceOwned.length > 0) refuseSurfaceParameters(surfaceOwned);

  const columns = await rowSource.probe({
    caller,
    sql,
    ...(parameters ? { parameters } : {}),
  });

  const plan = validated.appFunctions;
  if (!judgesSomething(plan)) {
    throw new InstantEvalQueryMissingColumnsError({
      missing: [],
      needsEvalFunction: true,
    });
  }

  const missing = missingColumnsIn(columns);
  if (missing.length > 0) {
    throw new InstantEvalQueryMissingColumnsError({
      missing,
      needsEvalFunction: false,
    });
  }

  return {
    sql,
    parameters: parameters ?? {},
    questions: instantEvalRunQuestions(plan),
    plan,
    keyColumns: instantEvalKeyColumns(columns),
    columns,
  };
}
