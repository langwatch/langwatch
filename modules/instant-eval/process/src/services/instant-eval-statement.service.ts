/**
 * Whether a statement can be a run, decided before anything is spent: the
 * reserved names first, then the query policy, then the projection on a
 * `LIMIT 0` probe that judges nothing.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import type {
  LangWatchQLAcceptedStatement,
  LangWatchQLAppFunctionCall,
  LangWatchQLCaller,
  LangWatchQLColumn,
  LangWatchQLJudgementCall,
  LangWatchQLProtections,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { isLangWatchQLSurfaceParameter } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  InstantEvalQueryInvalidError,
  InstantEvalQueryMissingColumnsError,
} from "@langwatch/instant-eval-contract";

import {
  INSTANT_EVAL_RESERVED_PARAMETERS,
  INSTANT_EVAL_TRACE_COLUMN,
  instantEvalKeyColumns,
  isInstantEvalReservedParameter,
} from "../rules/instant-eval-composition.rules.ts";
import {
  type InstantEvalRunQuestion,
  instantEvalRunQuestions,
} from "../rules/instant-eval-run-questions.rules.ts";
import type { InstantEvalRowSourceService } from "./instant-eval-row-source.service.ts";

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

/** The Analytics peer, narrowed to what admitting a run's statement asks of it. */
export interface InstantEvalStatementValidator {
  validateLangWatchQL(input: LangWatchQLValidationInput): LangWatchQLAcceptedStatement;
  describeLangWatchQLJudgements(input: {
    appFunctions: readonly LangWatchQLAppFunctionCall[];
  }): readonly LangWatchQLJudgementCall[];
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
    ...new Set([...declared, ...supplied].filter((name) => isInstantEvalReservedParameter(name))),
  ].toSorted();
}

function refuseReservedParameters(names: readonly string[]): never {
  throw new InstantEvalQueryInvalidError({
    reason: `An Instant Eval run binds ${INSTANT_EVAL_RESERVED_PARAMETERS.join(" and ")} itself, so a statement cannot use them.`,
    parameters: names,
  });
}

/**
 * The statement's declared parameters a job has no way to fill. Refused rather
 * than defaulted: choosing a period on the caller's behalf would answer a
 * different question than the one they wrote.
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

  return present.has(INSTANT_EVAL_TRACE_COLUMN) ? [] : [INSTANT_EVAL_TRACE_COLUMN];
}

export class InstantEvalStatementService {
  private constructor(
    private readonly analytics: InstantEvalStatementValidator,
    private readonly rowSource: InstantEvalRowSourceService,
  ) {}

  static create({
    analytics,
    rowSource,
  }: {
    analytics: InstantEvalStatementValidator;
    rowSource: InstantEvalRowSourceService;
  }): InstantEvalStatementService {
    return new InstantEvalStatementService(analytics, rowSource);
  }

  async accept({
    caller,
    protections,
    sql,
    parameters,
  }: {
    readonly caller: LangWatchQLCaller;
    readonly protections: LangWatchQLProtections;
    readonly sql: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
  }): Promise<AcceptedInstantEvalStatement> {
    const suppliedReserved = reservedNamesIn({
      declared: [],
      supplied: Object.keys(parameters ?? {}),
    });
    if (suppliedReserved.length > 0) refuseReservedParameters(suppliedReserved);

    const validated = this.#validateForRun({ caller, protections, sql, parameters });
    this.#refuseUnfillableParameters(validated.parameters.map((parameter) => parameter.name));

    const columns = await this.rowSource.probe({
      caller,
      protections,
      sql,
      ...(parameters ? { parameters } : {}),
    });
    const plan = validated.appFunctions;
    const judgements = this.analytics.describeLangWatchQLJudgements({ appFunctions: plan });
    this.#refuseIncompleteProjection({ judgements, columns });

    return {
      sql,
      parameters: parameters ?? {},
      questions: instantEvalRunQuestions(judgements),
      plan,
      keyColumns: instantEvalKeyColumns(columns),
      columns,
    };
  }

  /**
   * The policy's verdict, re-raised under the run's own code so the family
   * answers one code for "this statement cannot be a run", with the policy's
   * violations carried so the caller still learns which clause to change.
   */
  #validateForRun({
    caller,
    protections,
    sql,
    parameters,
  }: {
    readonly caller: LangWatchQLCaller;
    readonly protections: LangWatchQLProtections;
    readonly sql: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
  }): LangWatchQLAcceptedStatement {
    try {
      return this.analytics.validateLangWatchQL({
        projectId: caller.id,
        protections,
        sql,
        ...(parameters ? { parameters } : {}),
        // A run only exists because the project may judge, and the service
        // checked that before it got here.
        isInstantEvalsEnabled: true,
      });
    } catch (error) {
      if (!(error instanceof HandledError)) throw error;

      throw new InstantEvalQueryInvalidError({
        reason: error.message,
        violations: error.meta.violations,
        reasons: [error],
      });
    }
  }

  /** Refuses a declared parameter the run binds itself or a surface would fill. */
  #refuseUnfillableParameters(declared: readonly string[]): void {
    const reserved = reservedNamesIn({ declared, supplied: [] });
    if (reserved.length > 0) refuseReservedParameters(reserved);

    const surfaceOwned = declared.filter((name) => isLangWatchQLSurfaceParameter(name)).toSorted();
    if (surfaceOwned.length > 0) refuseSurfaceParameters(surfaceOwned);
  }

  /** Refuses a projection with nothing to judge, or nothing to tie it to. */
  #refuseIncompleteProjection({
    judgements,
    columns,
  }: {
    readonly judgements: readonly LangWatchQLJudgementCall[];
    readonly columns: readonly LangWatchQLColumn[];
  }): void {
    if (judgements.length === 0) {
      throw new InstantEvalQueryMissingColumnsError({ missing: [], isEvalFunctionMissing: true });
    }
    const missing = missingColumnsIn(columns);
    if (missing.length > 0) {
      throw new InstantEvalQueryMissingColumnsError({ missing, isEvalFunctionMissing: false });
    }
  }
}
