/**
 * LangWatchQL analytics SQL — the service the endpoints call.
 *
 * Composes four layers that are each proven on their own: the schema catalog
 * (`./catalog/`), the default-deny AST validator (`./validation/`), the
 * database-side access model (`./provisioning/accessModel.ts`), and the execution seam
 * (`./executor.ts`). Nothing here re-decides what any of them decided — the
 * value of this file is the *order*, and the order is load-bearing:
 *
 *  1. Resolve the caller's tenant and content permissions from the
 *     authenticated server context. Never from the request, never from the SQL.
 *  2. Derive the validator's policy from the catalog *for those permissions*,
 *     so `allowedTables` and `gatedColumns` are a function of who is asking.
 *  3. Validate, then resolve the surface's time window into the reserved
 *     parameters the statement declares (`./resolveTimeWindow.ts`) — in that order,
 *     because an injected window is what satisfies the missing-parameter check.
 *     The granularity declaration is resolved the same way at run. A step finer
 *     than the period's bucket budget allows is refused by default, because a
 *     caller who picked the step meant it; the dashboard widget surface, whose
 *     period moves under a saved step, opts into coarsening instead and is told
 *     what it got. A refusal is thrown as the validator's own handled error and
 *     the query never reaches the database.
 *  4. Execute as the restricted identity, carrying the caller's tenant
 *     capability as the one setting the profile lets a query change.
 *  5. Replace every app-function key the projection asked for with the value it
 *     names (`./appFunctions/hydrate.ts`), reading through the tenant-scoped
 *     trace services with the caller's own permissions. Nothing happens here
 *     for a statement that called none.
 *  6. Shape the result, and run the advisory diagnostics (`./diagnostics.ts`)
 *     over the facts step 3 recorded and the rows steps 4 and 5 produced.
 *
 * ## Where the isolation actually lives
 *
 * Not here. Step 4 is the whole of it: the row policies resolve the tenant from
 * the capability, so a bug anywhere in steps 1-3 costs a caller a wrong refusal
 * or a wrong acceptance, never another tenant's rows. That is deliberate — a
 * gateway is a bad place to keep a security boundary, and this one is defense
 * in depth over a boundary that was proven against the database directly.
 *
 * ## Two ceilings, two behaviours
 *
 * The settings profile pins `readonly`, `max_execution_time` and
 * `max_memory_usage` `CONST`, so a query that outgrows the *database's* budget
 * is killed by the server and surfaces as a coded error. The ceilings this
 * layer adds are about the response, and neither cuts silently: a statement
 * that names no `LIMIT` is capped by one this layer appends (a too-high
 * explicit `LIMIT` is refused before execution), and a result past the byte
 * ceiling is refused outright as `lwql_result_too_large`. Neither can be
 * relaxed by a caller: the row cap is applied to the statement itself, the byte
 * ceiling is not in the request shape.
 *
 * @see specs/lwql/api.feature
 * @see ./provisioning/accessModel.ts — the isolation this composes over
 */

import { createLogger } from "@langwatch/observability";
import type { InstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier/classifier";
import {
  instantEvalCostUsd,
  instantEvalPriceUsd,
} from "~/server/app-layer/instant-evals/classifier/pricing";
import type { Protections } from "../../traces/protections";
import {
  callsEvalFunction,
  statementMightCallEvalFunction,
} from "./appFunctions/evalCatalog";
import { hydrateLangWatchQLAppFunctions } from "./appFunctions/hydrate";
import type {
  LangWatchQLEvalUsage,
  LangWatchQLHydrationResult,
} from "./appFunctions/hydration/contract";
import {
  createLangWatchQLAppFunctionTraceSource,
  type LangWatchQLAppFunctionTraceSource,
} from "./appFunctions/traceSource";
import { lwqlTenantCapabilitySet } from "./capability";
import { LWQL_VIEW_CATALOG } from "./catalog/lwqlViews";
import {
  type LangWatchQLViewDefinition,
  lwqlAllowedTables,
  lwqlGatedColumns,
  lwqlHeldPermissions,
  lwqlVisibleViews,
} from "./catalog/types";
import {
  type LangWatchQLAppFunctionDiagnosticsInput,
  type LangWatchQLDiagnostic,
  lwqlDiagnostics,
} from "./diagnostics";
import {
  LangWatchQLParameterMissingError,
  LangWatchQLResultTooLargeError,
  LangWatchQLUnavailableError,
} from "./errors";
import {
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  type LangWatchQLColumn,
  type LangWatchQLExecutor,
  type LangWatchQLResultLimits,
  type LangWatchQLStatistics,
  lwqlConnectionFromEnv,
} from "./executor";
import {
  createLangWatchQLInstantEvalSupport,
  type LangWatchQLInstantEvalSupport,
} from "./instantEvalSupport";
import {
  assertLangWatchQLGranularityDeclaration,
  type LangWatchQLBudgetOverflowMode,
  type LangWatchQLGranularityResolution,
  resolveLangWatchQLGranularity,
  resolveLangWatchQLTimeWindow,
} from "./resolveTimeWindow";
import { describeLangWatchQLSchema, type LangWatchQLSchema } from "./schema";
import type { LangWatchQLTimeWindow } from "./timeWindow";
import { LWQL_PERIOD_GRANULARITY_PARAMETER } from "./timeWindow";
import { lwqlValidationError } from "./validation/errors";
import type { SqlSourcePosition } from "./validation/parser";
import {
  type AcceptedLangWatchQL,
  validateLangWatchQL,
} from "./validation/validate";

const logger = createLogger("langwatch:analytics:lwql");

/**
 * The run-path half of the reserved-parameter contract, as one step: resolve
 * what the caller's window and step mean for this request, then refuse when
 * any declared reserved name would still reach the
 * database without a value — one refusal naming everything the surface forgot
 * rather than only its first omission.
 *
 * An unvalued declared name cannot simply ride along: ClickHouse answers a
 * missing substitution with `UNKNOWN_QUERY_PARAMETER`, which reaches the caller
 * as an unknown 500 for something a surface can fix by sending its window or
 * step. Refusing here, before execution, is what turns that into a named code.
 *
 * @throws {LangWatchQLReservedGranularityTypeError} for a mistyped declaration
 *   or malformed step, {@link LangWatchQLReservedParameterSuppliedError} when
 *   the request carries a surface-owned value,
 *   {@link LangWatchQLGranularityTooFineError} on bucket-budget overflow, and
 *   {@link LangWatchQLParameterMissingError} when a declared reserved name has
 *   no value.
 */
function resolveRunGranularityOrRefuseUnfilled({
  declared,
  parameters,
  timeWindow,
  granularitySeconds,
  onBudgetOverflow,
  awaitingTimeWindow,
}: {
  /** Bound parameters the validated statement declares. */
  readonly declared: Parameters<
    typeof resolveLangWatchQLGranularity
  >[0]["declared"];
  /** Values the caller sent. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** The period the surface is showing, when it has one. */
  readonly timeWindow?: LangWatchQLTimeWindow;
  /** The step the caller-owned surface chose, when it offers one. */
  readonly granularitySeconds?: number;
  /**
   * What an overflowing period does. Defaults to refusing, which is what every
   * caller-owned door wants.
   */
  readonly onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
  /**
   * Reserved window names no window filled — already computed by validate,
   * joined here so one refusal can name every omission together.
   */
  readonly awaitingTimeWindow: readonly string[];
}): LangWatchQLGranularityResolution {
  // Caller-owned doors resolve the granularity contract with refuse on
  // overflow: whoever is asking picked the step, so coarsening it for them
  // would change the answer they asked for. A surface that picked the step on
  // the member's behalf rather than at their request — the dashboard, whose
  // period is dragged around by a control the widget does not own — passes
  // "coarsen" instead, and reports the substitution rather than hiding it.
  const granularity = resolveLangWatchQLGranularity({
    declared,
    ...(parameters ? { parameters } : {}),
    ...(granularitySeconds !== undefined ? { granularitySeconds } : {}),
    ...(timeWindow ? { timeWindow } : {}),
    onBudgetOverflow: onBudgetOverflow ?? "refuse",
  });

  // Validate lists a declared granularity as awaiting alongside the window
  // pair; whether it is actually unfilled is this resolver's answer, so the
  // name is re-derived from the resolution rather than carried over.
  const unfilledReserved = [
    ...awaitingTimeWindow.filter(
      (name) => name !== LWQL_PERIOD_GRANULARITY_PARAMETER,
    ),
    ...(granularity.followsGranularity &&
    granularity.granularitySeconds === undefined
      ? [LWQL_PERIOD_GRANULARITY_PARAMETER]
      : []),
  ].sort();
  if (unfilledReserved.length > 0) {
    throw new LangWatchQLParameterMissingError(unfilledReserved);
  }

  return granularity;
}

/**
 * Appends the default row `LIMIT` to a statement that named none.
 *
 * A trailing `;` is stripped and the clause goes on its own line, so it is
 * neither swallowed by a trailing line comment nor turned into a second
 * statement. This is the one edit this API makes to a submitted statement: the
 * validator decides when it applies (`appendRowLimit`, only for a single
 * top-level `SELECT` naming no `LIMIT`) and refuses a too-high explicit
 * `LIMIT` before this runs.
 *
 * `beforeOffset`, when given, is the position of that statement's own
 * `OFFSET` (`SELECT … OFFSET 5` with no `LIMIT`) — ClickHouse only accepts
 * `LIMIT n OFFSET m` in that order, so the default is inserted immediately
 * before the `OFFSET` keyword instead of appended after it, which would be a
 * syntax error.
 */
export function appendDefaultRowLimit(
  sql: string,
  maxRows: number,
  beforeOffset?: SqlSourcePosition,
): string {
  if (beforeOffset) {
    // The AST position names the OFFSET clause's *value* (its literal or bound
    // parameter), not the `OFFSET` keyword itself, which the parser gives no
    // node for. The keyword always sits immediately before that value, so the
    // insertion point is the nearest `OFFSET` before it — found by search
    // rather than assumed adjacent, since arbitrary whitespace or a comment
    // may separate the two.
    const valueAt = charIndexOfPosition(sql, beforeOffset);
    const keywordAt = lastOffsetKeywordBefore(sql, valueAt);
    if (keywordAt !== null) {
      return `${sql.slice(0, keywordAt)}LIMIT ${maxRows} ${sql.slice(keywordAt)}`;
    }
  }
  const trimmed = sql.replace(/;\s*$/u, "").replace(/\s+$/u, "");
  return `${trimmed}\nLIMIT ${maxRows}`;
}

/**
 * Converts a parser's 1-based `{ line, column }` into a character index into
 * `sql`, so {@link appendDefaultRowLimit} can splice text at an exact AST
 * position instead of guessing at a keyword's location with a regular
 * expression, which a string literal or comment containing the word `OFFSET`
 * could mislead.
 */
function charIndexOfPosition(sql: string, position: SqlSourcePosition): number {
  const lines = sql.split("\n");
  let index = 0;
  for (let i = 0; i < position.line - 1; i++) {
    index += (lines[i]?.length ?? 0) + 1;
  }
  return index + (position.column - 1);
}

/** The start of the last `OFFSET` keyword before `before`, or `null` if none is found. */
function lastOffsetKeywordBefore(sql: string, before: number): number | null {
  const pattern = /\bOFFSET\b/gi;
  let match: RegExpExecArray | null;
  let found: number | null = null;
  while ((match = pattern.exec(sql)) !== null) {
    if (match.index >= before) break;
    found = match.index;
  }
  return found;
}

/**
 * Refuses a result whose JSON encoding exceeds the byte ceiling, naming the cap.
 *
 * The work is bounded: the row count is already capped by the appended (or the
 * caller's own) `LIMIT` before this runs, so this walks at most that many rows.
 *
 * @throws {LangWatchQLResultTooLargeError} when the rows exceed `maxResultBytes`.
 */
function assertResultWithinByteCeiling({
  rows,
  maxResultBytes,
}: {
  rows: readonly Record<string, unknown>[];
  maxResultBytes: number;
}): void {
  let bytes = 0;
  for (const row of rows) {
    bytes += JSON.stringify(row)?.length ?? 0;
    if (bytes > maxResultBytes) {
      throw new LangWatchQLResultTooLargeError(maxResultBytes);
    }
  }
}

/** What a caller gets back from the query endpoint. */
export interface LangWatchQLQueryResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: LangWatchQLStatistics;
  /**
   * Notes about the result. An empty list means no known issue was detected,
   * which is not a claim that the answer is the one the caller meant — see
   * `LWQL_CLEAN_DIAGNOSTICS_MEANING` in `./diagnostics.ts`.
   */
  readonly diagnostics: readonly LangWatchQLDiagnostic[];
  /**
   * Whether the statement declared the reserved time-window parameters and was
   * therefore given the period the surface is showing.
   *
   * Declaring is all this reports. The author writes the comparison, so a
   * statement that names the parameters without comparing against them reads
   * all of time and still answers `true` — the surface can know what it handed
   * over, not what the `WHERE` clause did with it.
   *
   * `false` is not a failure — an all-time total is a legitimate chart — but it
   * is the fact a card has to say out loud, because a chart that quietly ignores
   * the period beside one that follows it is the bug this contract exists to
   * prevent.
   *
   * @see ./timeWindow.ts
   */
  readonly followsTimeWindow: boolean;
  /**
   * Whether the statement declares the reserved granularity parameter at all.
   *
   * Like `followsTimeWindow`, declaring is all this reports: the author writes
   * the bucketing expression, so a declaration the SQL never multiplies an
   * interval with still answers `true`.
   */
  readonly followsGranularity: boolean;
  /**
   * The step this run was bucketed at, present when the statement declares the
   * granularity parameter and the caller supplied a step for it. Absent
   * otherwise — an undeclared statement keeps whatever bucketing its SQL
   * hard-codes.
   */
  readonly granularitySeconds?: number;
  /**
   * The step the caller asked for, present only when this run coarsened.
   * Every current caller refuses on overflow rather than coarsening, so this
   * is never set through {@link execute} today; it is carried so the result
   * shape is already the one the dashboard's coarsening door reports into.
   */
  readonly coarsenedFromSeconds?: number;
}

/** One project a query runs for. Only these two fields are ever needed. */
export interface LangWatchQLCaller {
  /** Project id. Used for logging; the database resolves the tenant itself. */
  readonly id: string;
  /**
   * The project's LangWatchQL secret (`Project.lwqlKey`), hashed into
   * the tenant capability. Never logged.
   */
  readonly lwqlKey: string;
}

export interface LangWatchQLExecuteInput {
  /**
   * Every project this query may read — one for an in-product surface bound to
   * the project it is showing, many for an API key that reaches several. Their
   * secrets become the tenant-capability SET the row policy resolves, so a
   * query returns the union of these projects' rows and nothing else. An empty
   * set is a valid scope (a key that can read nothing) and reads zero rows; the
   * database, not this, decides which rows each project contributes.
   */
  readonly projects: readonly LangWatchQLCaller[];
  /** Resolved server-side from the authenticated context. */
  readonly protections: Protections;
  /** The SQL exactly as submitted. */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /**
   * The period the surface is showing, supplied by the surface and never by the
   * caller's own parameters. Injected into the reserved names the statement
   * declares, and ignored by a statement that declares neither.
   *
   * @see ./timeWindow.ts
   */
  readonly timeWindow?: LangWatchQLTimeWindow;
  /**
   * The datapoint step the surface chose, in seconds, for a statement that
   * declares `{dashboard_context_granularity_seconds:UInt32}`. Injected like the window.
   *
   * Ignored by a statement that does not declare the parameter.
   */
  readonly granularitySeconds?: number;
  /**
   * What to do when the period at the chosen step would exceed the bucket
   * ceiling. Defaults to `"refuse"`.
   *
   * Refusing is right wherever the member picked the step for the question
   * they are asking — the workbench, the REST door — because silently widening
   * their buckets answers a different question than the one they wrote.
   *
   * `"coarsen"` belongs to a surface whose period moves independently of the
   * step: a dashboard widget's step is saved once, and the dashboard's period
   * control can later be dragged wide enough to overflow it. Refusing there
   * would blank a card the member never touched, so it coarsens to the finest
   * step that fits and reports `coarsenedFromSeconds` so the widget can say so
   * rather than quietly redraw.
   */
  readonly onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
  /**
   * The caller's cancellation, where the surface has one.
   *
   * Only the judged path reads it, and it is the one path that needs it: a
   * statement calling an eval function keeps spending money per row after the
   * caller has gone, which no other LangWatchQL query does. The REST route
   * passes the request's own signal, so a client that hangs up stops the
   * judging rather than paying for the rest of it.
   */
  readonly signal?: AbortSignal;
}

/**
 * A statement that passed the gate, plus what the surface's time window means
 * for it.
 *
 * The two extra facts are here rather than on {@link AcceptedLangWatchQL}
 * because they are not properties of the parse: they depend on what the caller
 * sent and on which surface is asking.
 */
export interface ValidatedLangWatchQL extends AcceptedLangWatchQL {
  /** Whether the statement declares the reserved time-window parameters. */
  readonly followsTimeWindow: boolean;
  /**
   * The values to execute with — the caller's, plus the window this surface
   * injected for the reserved names the statement declares.
   */
  readonly boundParameters?: Readonly<Record<string, unknown>>;
  /**
   * Reserved names the statement declares that no window filled.
   *
   * Never a refusal here: validating for a *save* has no window and must not be
   * refused for it, because the window belongs to whoever later renders the
   * chart. {@link LangWatchQLService.execute} is what cannot proceed with one.
   */
  readonly awaitingTimeWindow: readonly string[];
}

export interface LangWatchQLServiceDependencies {
  /**
   * How queries reach the database, or `null` on a deployment with no LangWatchQL
   * identity provisioned — in which case every query is refused rather than run
   * with weaker guarantees.
   */
  readonly executor: LangWatchQLExecutor | null;
  /** Database the LangWatchQL views live in, and what unqualified names resolve to. */
  readonly database: string;
  readonly views?: readonly LangWatchQLViewDefinition[];
  /**
   * Result ceilings, each one falling back to its shipped value.
   *
   * Partial because the ceilings are independent of each other: a caller that
   * wants a smaller row cap has no opinion on the hydration byte budget, and
   * naming one should not silently drop the rest to `undefined`.
   */
  readonly limits?: Partial<LangWatchQLResultLimits>;
  /**
   * Where the app-function hydration stage reads traces from.
   *
   * A dependency for the same reason the clock below is one: the rules about
   * caps, truncation and unresolved keys are worth a test that needs no
   * datastore. Built on first use rather than in the constructor, so a
   * deployment whose callers never write an app function never constructs a
   * trace service.
   */
  readonly traceSource?: LangWatchQLAppFunctionTraceSource;
  /**
   * Everything an eval function needs: the project gate, the judge, the
   * ceilings on one query, and where its cost is recorded.
   *
   * A dependency, and built on first use like the trace source, so a suite can
   * drive the whole judged path against a fake classifier with no datastore —
   * and a deployment whose callers never write an eval function never resolves
   * a feature flag or opens a connection pool.
   */
  readonly instantEvals?: LangWatchQLInstantEvalSupport;
  /**
   * The clock the diagnostics ask "has this period finished yet" against.
   *
   * A dependency rather than a call to `Date.now()` inside the rule, so that
   * the diagnostics a result earns are a function of the result and the instant
   * — which is what lets a suite pin the unfinished-period rule to a seeded
   * fixture instead of to whenever it happens to run.
   */
  readonly now?: () => Date;
}

/**
 * The LangWatchQL analytics SQL API's application service.
 *
 * Holds no SQL of its own and opens no connection: it derives policy from the
 * catalog and hands the caller's statement, untouched, to the executor.
 */
export class LangWatchQLService {
  private readonly views: readonly LangWatchQLViewDefinition[];
  private readonly limits: LangWatchQLResultLimits;
  private readonly now: () => Date;
  private cachedTraceSource?: LangWatchQLAppFunctionTraceSource;
  private cachedInstantEvals?: LangWatchQLInstantEvalSupport;

  /**
   * Releases the transport the executor holds, where it holds one.
   *
   * The service does not own the executor's construction, but it is the only
   * thing that reaches it, so it is the only place that can hand it back.
   */
  async close(): Promise<void> {
    await this.deps.executor?.close?.();
  }

  constructor(private readonly deps: LangWatchQLServiceDependencies) {
    this.views = deps.views ?? LWQL_VIEW_CATALOG;
    this.limits = { ...DEFAULT_LWQL_RESULT_LIMITS, ...deps.limits };
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Whether this deployment has a LangWatchQL identity to run a query as.
   *
   * The capability read the workbench navigation gates on, so an unprovisioned
   * deployment never offers a surface it would then refuse. Fail-closed by
   * construction: it reports the presence of the executor, which is the same
   * fact {@link execute} refuses on, so the two can never disagree.
   */
  get available(): boolean {
    return this.deps.executor != null;
  }

  /**
   * The LangWatchQL schema this caller's permissions unlock.
   *
   * Needs no executor: the schema is the catalog, and a deployment with no
   * LangWatchQL identity can still describe what the API would expose. Answering
   * it does not disclose anything a caller could not read in the docs.
   */
  async describeSchema({
    projectIds,
    protections,
  }: {
    /** The scope whose eval-function availability is being described. */
    projectIds: readonly string[];
    protections: Protections;
  }): Promise<LangWatchQLSchema> {
    return describeLangWatchQLSchema({
      database: this.deps.database,
      protections,
      views: this.views,
      instantEvalsEnabled: await this.instantEvals().isEnabled({ projectIds }),
    });
  }

  /**
   * The database every dataset name is qualified with.
   *
   * Published because the query reference assembles the same schema alongside a
   * second query language, and the qualifier is a deployment fact only this
   * service holds — `analytics` in production, a per-suite database under test.
   * Re-deriving it at the reference would mean a document whose dataset names
   * are unrunnable on exactly the deployments where it differs.
   */
  get database(): string {
    return this.deps.database;
  }

  /**
   * Decides whether a statement may run for these permissions, without running
   * it — steps 2 and 3 of the order this file documents.
   *
   * Exposed as its own step because a second caller needs the verdict and not
   * the rows: saving a workbench chart stores SQL that will be executed later,
   * by whoever opens it, and must refuse at write what the query endpoint would
   * refuse at run (`server/analytics/saved-workbench-charts`). That caller
   * asking this rather than re-deriving the policy is what keeps one refusal
   * decision in the codebase — and {@link execute} calling it too is what stops
   * the two drifting apart.
   *
   * Needs no executor: a deployment with no restricted identity still knows
   * what it would have refused.
   *
   * @throws the validator's handled error when the policy refuses the query,
   *   {@link LangWatchQLParameterMissingError} when a declared parameter has no
   *   value, the two time-window refusals in `./timeWindow.ts` when a
   *   reserved name is supplied by the caller or declared as a non-date-time,
   *   {@link LangWatchQLReservedGranularityTypeError} when the granularity
   *   declaration or a surface-supplied step is malformed, and
   *   {@link LangWatchQLGranularityRequiresTimeWindowError} when granularity
   *   is declared without both period bounds.
   */
  validate({
    projectId,
    protections,
    sql,
    parameters,
    timeWindow,
    instantEvalsEnabled = false,
  }: {
    /** Logged with a refusal. The database, not this, decides the tenant. */
    readonly projectId: string;
    readonly protections: Protections;
    readonly sql: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    /** The period the surface is showing, when one is asking. */
    readonly timeWindow?: LangWatchQLTimeWindow;
    /**
     * Whether an eval function may be called.
     *
     * Resolved by {@link LangWatchQLService.execute}, which has the project and
     * can await it. Defaulting to false is what makes the *save* path refuse a
     * judged statement: saving a chart stores SQL somebody else will run later,
     * and a gate resolved at save time would be the wrong caller's answer.
     */
    readonly instantEvalsEnabled?: boolean;
  }): ValidatedLangWatchQL {
    const validation = validateLangWatchQL({
      sql,
      // The datasets this caller can reach, not every dataset the catalog has.
      // A dataset gated as a whole is absent from the schema endpoint, and
      // `allowedTables` is what makes it *unnameable* rather than merely
      // unlisted: derived from the full catalog, a caller could name a hidden
      // dataset and read its row-policed rows despite holding none of the
      // permissions that dataset requires.
      allowedTables: lwqlAllowedTables({
        database: this.deps.database,
        views: lwqlVisibleViews({ protections, views: this.views }),
      }),
      // Derived from the *full* catalog on purpose: a column of a hidden
      // dataset must stay gated so that naming it unqualified — where no table
      // reference reveals which dataset it came from — is refused too.
      gatedColumns: lwqlGatedColumns({ protections, views: this.views }),
      // The positive form of the same permissions, which is what an app
      // function is gated on: it has no column for the withheld set to name.
      heldPermissions: [...lwqlHeldPermissions(protections)],
      instantEvalsEnabled,
      defaultDatabase: this.deps.database,
    });

    if (!validation.ok) {
      logger.info(
        {
          projectId,
          violations: validation.violations.map((violation) => violation.code),
        },
        "LangWatchQL refused by policy",
      );
      throw lwqlValidationError(validation);
    }

    // The granularity rules ride on every validate -- persisted saves AND
    // ad-hoc execution, since execute() calls validate() -- which is what
    // makes REST saves, tRPC saves and workbench runs refuse identically.
    assertLangWatchQLGranularityDeclaration(validation.parameters);

    // Before the missing-parameter check, never after: an injected window IS a
    // value, and checking first would refuse every period-aware statement for
    // the two names the surface was about to supply.
    const window = resolveLangWatchQLTimeWindow({
      declared: validation.parameters,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
    });

    const missing = validation.parameters
      .map((parameter) => parameter.name)
      .filter((name) => window.parameters?.[name] === undefined)
      // A reserved name with no window yet is not missing — it is deferred to
      // the surface, and `execute` is where that becomes a refusal.
      .filter((name) => !window.awaitingTimeWindow.includes(name))
      // The granularity is surface-owned exactly like the window bounds, so a
      // declaration with no step yet is deferred rather than missing: a save
      // request can never legitimately carry one (the reserved-supplied sweep
      // above refuses it), and demanding it here would leave every chart that
      // declares the parameter unsavable.
      .filter((name) => name !== LWQL_PERIOD_GRANULARITY_PARAMETER)
      .sort();
    if (missing.length > 0) throw new LangWatchQLParameterMissingError(missing);

    return {
      ...validation,
      followsTimeWindow: window.followsTimeWindow,
      ...(window.parameters ? { boundParameters: window.parameters } : {}),
      awaitingTimeWindow: window.awaitingTimeWindow,
    };
  }

  /**
   * Validates a submitted statement against this caller's permissions, then
   * executes it as the restricted identity.
   *
   * @throws the validator's handled error when the policy refuses the query,
   *   {@link LangWatchQLParameterMissingError} when a declared parameter has no
   *   value — including a declared granularity with no step supplied —
   *   {@link LangWatchQLGranularityTooFineError} when the period at the
   *   supplied step overflows the bucket ceiling, and
   *   {@link LangWatchQLUnavailableError} when no LangWatchQL identity
   *   is provisioned.
   */
  async execute({
    projects,
    protections,
    sql,
    parameters,
    timeWindow,
    granularitySeconds,
    onBudgetOverflow,
    signal,
  }: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    // Only logging reads this; the database resolves the tenant set itself.
    const scopeLabel =
      projects.map((project) => project.id).join(",") || "(none)";

    // Resolved before validation, because whether an eval function may be
    // called is part of what the validator decides — but only for a statement
    // that names one. Resolving it costs a project read and a flag evaluation,
    // and almost no statement judges anything.
    const instantEvalsEnabled =
      statementMightCallEvalFunction(sql) &&
      (await this.instantEvals().isEnabled({
        projectIds: projects.map((project) => project.id),
      }));

    const validation = this.validate({
      projectId: scopeLabel,
      protections,
      sql,
      instantEvalsEnabled,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
    });
    const granularity = resolveRunGranularityOrRefuseUnfilled({
      declared: validation.parameters,
      ...(parameters ? { parameters } : {}),
      ...(granularitySeconds !== undefined ? { granularitySeconds } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      ...(onBudgetOverflow ? { onBudgetOverflow } : {}),
      awaitingTimeWindow: validation.awaitingTimeWindow,
    });

    // Fail closed. The check is here rather than in the constructor so that a
    // deployment with no LangWatchQL identity still answers the schema endpoint,
    // and so that the refusal is a per-request handled error rather than a
    // boot-time crash of an app that mostly does other things.
    const { executor } = this.deps;
    if (!executor) {
      logger.error(
        { projectIds: projects.map((project) => project.id) },
        "LangWatchQL query refused: no restricted identity is provisioned",
      );
      throw new LangWatchQLUnavailableError();
    }

    return await this.executeValidated({
      executor,
      projects,
      protections,
      sql,
      validation,
      granularity,
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Runs a statement that passed every gate as the restricted identity, and
   * shapes what came back with the facts those gates recorded.
   *
   * Split from {@link execute} because it is the half of the order that has no
   * more decisions to make — only the database call, the advisory diagnostics
   * over its answer, and the result both of them describe.
   */
  /**
   * The trace source the hydration stage reads through, built on first use.
   *
   * Lazy rather than constructed with the service: a deployment whose callers
   * never write an app function never builds a trace service, and the endpoint
   * suites that swap the executor several times a file do not pay for one
   * either.
   */
  private traceSource(): LangWatchQLAppFunctionTraceSource {
    return (this.cachedTraceSource ??=
      this.deps.traceSource ?? createLangWatchQLAppFunctionTraceSource());
  }

  /** The Instant Evals dependency, built on first use. */
  private instantEvals(): LangWatchQLInstantEvalSupport {
    return (this.cachedInstantEvals ??=
      this.deps.instantEvals ?? createLangWatchQLInstantEvalSupport());
  }

  /**
   * Step 4: the database call, and the one ceiling that is checked on what it
   * returned rather than on what the application then put in it.
   *
   * Split from {@link executeValidated} because it is the half with no
   * decisions left in it — the statement is settled, the scope is settled, and
   * what comes back is rows.
   */
  private async runStatement({
    executor,
    projects,
    sql,
    validation,
    granularity,
  }: {
    readonly executor: LangWatchQLExecutor;
    readonly projects: readonly LangWatchQLCaller[];
    readonly sql: string;
    readonly validation: ValidatedLangWatchQL;
    readonly granularity: LangWatchQLGranularityResolution;
  }): Promise<Awaited<ReturnType<LangWatchQLExecutor["execute"]>>> {
    const executionParameters = executionParametersFor({
      validation,
      granularity,
    });

    const execution = await executor.execute({
      // The submitted statement, with one edit and no other: a default `LIMIT`
      // appended when the caller named none, so an unbounded query is capped
      // rather than streamed. A statement that already pages is sent verbatim.
      sql: validation.appendRowLimit
        ? appendDefaultRowLimit(
            sql,
            this.limits.maxRows,
            validation.appendRowLimitBeforeOffset,
          )
        : sql,
      ...(Object.keys(executionParameters).length > 0
        ? { parameters: executionParameters }
        : {}),
      tenantCapability: lwqlTenantCapabilitySet({
        secrets: projects.map((project) => project.lwqlKey),
      }),
      usesAppFunctions: validation.appFunctions.length > 0,
    });

    // A finished result larger than the byte ceiling is refused outright rather
    // than cut: a body that looks whole but is missing its tail is the worse
    // failure for an analytics caller. The row count is already bounded by the
    // LIMIT above; this is the ceiling a query can still overshoot on width.
    // Measured on what the database returned, which for an app-function query
    // is a page of keys — the hydrated bytes have their own ceiling below.
    assertResultWithinByteCeiling({
      rows: execution.rows,
      maxResultBytes: this.limits.maxResultBytes,
    });

    return execution;
  }

  /**
   * Steps 5a and 5b: turn the keys into values, then record what that cost.
   *
   * Hydration runs after the database and before the diagnostics, because the
   * diagnostics describe the answer a caller receives and hydration is what
   * decides what that is: the row count, the byte total, and the type of every
   * hydrated column. A statement that called no app function skips it entirely
   * and reads nothing.
   *
   * The bill comes after, because the number recorded is what the classifier
   * reported it charged, which only exists once it has answered. A query that
   * judged nothing records nothing.
   */
  private async hydrateAndBill({
    projects,
    protections,
    validation,
    execution,
    signal,
  }: {
    readonly projects: readonly LangWatchQLCaller[];
    readonly protections: Protections;
    readonly validation: ValidatedLangWatchQL;
    readonly execution: Awaited<ReturnType<LangWatchQLExecutor["execute"]>>;
    readonly signal?: AbortSignal;
  }): Promise<LangWatchQLHydrationResult> {
    // Only a statement that judges something builds the classifier: a query
    // that extracts a conversation and nothing else should not open a
    // connection pool to a third party it will never call.
    const judging = callsEvalFunction(validation.appFunctions)
      ? this.instantEvals()
      : null;
    // The validator admits an eval call only for a single-project scope, which
    // is what gives the bill below one owner. Reading it back here rather than
    // threading it down keeps that invariant beside the charge it pays for.
    const billedProject = projects.length === 1 ? projects[0] : undefined;

    const hydration = await hydrateLangWatchQLAppFunctions({
      projectIds: projects.map((project) => project.id),
      protections,
      calls: validation.appFunctions,
      columns: execution.columns,
      rows: execution.rows,
      limits: this.limits,
      traceSource: this.traceSource(),
      ...(judging
        ? {
            instantEvals: {
              classifier: judging.classifier(),
              maxConcurrency: judging.maxConcurrency,
              queryTokenBudget: judging.queryTokenBudget,
            },
          }
        : {}),
      ...(signal ? { signal } : {}),
    });

    if (judging && billedProject) {
      await recordInstantEvalCost({
        projectId: billedProject.id,
        usage: hydration.evalUsage,
        classifier: judging.classifier(),
        recordCost: judging.recordCost,
      });
    }
    return hydration;
  }

  private async executeValidated({
    executor,
    projects,
    protections,
    sql,
    validation,
    granularity,
    signal,
  }: {
    readonly executor: LangWatchQLExecutor;
    readonly projects: readonly LangWatchQLCaller[];
    readonly protections: Protections;
    readonly sql: string;
    readonly validation: ValidatedLangWatchQL;
    readonly granularity: LangWatchQLGranularityResolution;
    readonly signal?: AbortSignal;
  }): Promise<LangWatchQLQueryResult> {
    const execution = await this.runStatement({
      executor,
      projects,
      sql,
      validation,
      granularity,
    });

    const hydration = await this.hydrateAndBill({
      projects,
      protections,
      validation,
      execution,
      ...(signal ? { signal } : {}),
    });

    // The facts the walk recorded, plus what actually came back. Both halves
    // are needed and neither is re-derived: a rule about the query's shape
    // reads `validation`, a rule about the answer reads the rows.
    const diagnostics = lwqlDiagnostics({
      validation,
      database: this.deps.database,
      views: this.views,
      columns: hydration.columns,
      rows: hydration.rows,
      now: this.now(),
      ...appFunctionDiagnosticsInput({
        validation,
        hydration,
        limits: this.limits,
      }),
    });

    logExecuted({
      projects,
      validation,
      granularity,
      statistics: execution.statistics,
      rowsReturned: hydration.rows.length,
      diagnostics,
    });

    return {
      columns: hydration.columns,
      rows: hydration.rows,
      statistics: {
        ...execution.statistics,
        // Hydration can drop trailing rows at its own ceiling, so the count the
        // caller is told has to be the count they received.
        rowsReturned: hydration.rows.length,
      },
      diagnostics,
      followsTimeWindow: validation.followsTimeWindow,
      followsGranularity: granularity.followsGranularity,
      ...(granularity.granularitySeconds === undefined
        ? {}
        : { granularitySeconds: granularity.granularitySeconds }),
      ...(granularity.coarsenedFromSeconds === undefined
        ? {}
        : { coarsenedFromSeconds: granularity.coarsenedFromSeconds }),
    };
  }
}

/**
 * The bound parameters plus the step this run was bucketed at, when the
 * statement declares the parameter.
 *
 * Built unconditionally and omitted by the caller when empty, so an
 * unparameterised query keeps the request shape it had.
 */
function executionParametersFor({
  validation,
  granularity,
}: {
  validation: ValidatedLangWatchQL;
  granularity: LangWatchQLGranularityResolution;
}): Record<string, unknown> {
  return {
    ...validation.boundParameters,
    ...(granularity.granularitySeconds === undefined
      ? {}
      : {
          [LWQL_PERIOD_GRANULARITY_PARAMETER]: granularity.granularitySeconds,
        }),
  };
}

/**
 * What the hydration stage has to tell the diagnostics, or nothing at all.
 *
 * Omitted entirely for a statement that called no app function, so a query that
 * existed before this feature earns exactly the diagnostics it earned before.
 */
function appFunctionDiagnosticsInput({
  validation,
  hydration,
  limits,
}: {
  validation: ValidatedLangWatchQL;
  hydration: LangWatchQLHydrationResult;
  limits: LangWatchQLResultLimits;
}): { appFunctions?: LangWatchQLAppFunctionDiagnosticsInput } {
  if (validation.appFunctions.length === 0) return {};
  return {
    appFunctions: {
      isTruncatedByBytes: hydration.isTruncatedByBytes,
      maxHydratedBytes: limits.maxHydratedBytes,
      rowsReturned: hydration.rows.length,
      valueTruncations: hydration.valueTruncations,
      unresolvedKeys: hydration.unresolvedKeys,
      ...(hydration.evalUsage
        ? { skippedJudgements: hydration.evalUsage.skipped }
        : {}),
    },
  };
}

/** One line per executed statement, with what the caller actually received. */
function logExecuted({
  projects,
  validation,
  granularity,
  statistics,
  rowsReturned,
  diagnostics,
}: {
  projects: readonly LangWatchQLCaller[];
  validation: ValidatedLangWatchQL;
  granularity: LangWatchQLGranularityResolution;
  statistics: LangWatchQLStatistics;
  rowsReturned: number;
  diagnostics: readonly LangWatchQLDiagnostic[];
}): void {
  logger.info(
    {
      projectIds: projects.map((project) => project.id),
      tables: validation.tables,
      rowsReturned,
      rowsRead: statistics.rowsRead,
      elapsedMs: statistics.elapsedMs,
      diagnostics: diagnostics.map((diagnostic) => diagnostic.code),
      followsTimeWindow: validation.followsTimeWindow,
      followsGranularity: granularity.followsGranularity,
      appFunctions: validation.appFunctions.map((call) => call.function),
    },
    "LangWatchQL executed",
  );
}

/**
 * The `analytics.*` namespace the catalog documents, used when the deployment
 * names no other.
 */
export const DEFAULT_LWQL_DATABASE = "analytics";

/**
 * Builds the service from the environment.
 *
 * The database name defaults to the namespace the catalog documents, so a
 * deployment that provisions the standard objects needs only the credentials.
 */
export function createLangWatchQLService(
  overrides: Partial<LangWatchQLServiceDependencies> = {},
): LangWatchQLService {
  const connection = lwqlConnectionFromEnv();
  return new LangWatchQLService({
    executor: connection ? createLangWatchQLExecutor(connection) : null,
    database: connection?.database ?? DEFAULT_LWQL_DATABASE,
    ...overrides,
  });
}

/**
 * ## Why this is not on the application container — do not copy the pattern
 *
 * The house rule is that a server-side caller obtains a service from
 * `getApp()`, and a module-level cache with an exported setter is a second
 * dependency-injection mechanism. This slice keeps the local one anyway, and
 * the reason is the container's lifecycle rather than a preference:
 *
 *  - `App`'s fields are `readonly` and it is built once by `initializeApp`.
 *    There is no per-field override, so a suite swapping the executor means
 *    `resetApp()` plus a full re-initialisation with different dependencies.
 *  - The endpoint suites swap the executor *between describe blocks* — a
 *    Testcontainers-backed one, a throwing one, a lowered-ceilings one — half a
 *    dozen times per file. On the container that is half a dozen full app
 *    teardowns, each closing the event-sourcing and Redis handles the rest of
 *    the file still needs.
 *
 * Migrating is therefore a change to `dependencies.ts`, `presets.ts`, `app.ts`,
 * the barrel, the route and both endpoint suites, and it changes their
 * lifecycle rather than only their wiring. That is a slice of its own, not a
 * late edit to this one.
 *
 * The setter is reachable from anything importing the barrel, and that is a
 * real cost: nothing but a test should ever call it.
 */
let cached: LangWatchQLService | null = null;

/** The process-wide service, built from the environment on first use. */
export function getLangWatchQLService(): LangWatchQLService {
  cached ??= createLangWatchQLService();
  return cached;
}

/**
 * Replaces the process-wide service, or clears it so the next read rebuilds
 * from the environment.
 *
 * **Tests only.** The seam the endpoint suites wire a Testcontainers-provisioned
 * executor through. Production code builds its service from the environment and
 * never calls this — see the note above for why the container is not the seam
 * in this slice.
 */
export function setLangWatchQLService(
  service: LangWatchQLService | null,
): void {
  cached = service;
}

/**
 * Clears the process-wide service, releasing the transport it holds first.
 *
 * Separate from {@link setLangWatchQLService}, and awaitable, because closing a
 * connection pool is asynchronous and that setter is not. Making the setter
 * async would change every call site; having it start a close it cannot await
 * would leave an unobserved promise in a teardown path, which is the one place
 * a rejection has nowhere to go. So the suites that swap the service several
 * times per file call this between swaps and get the sockets back.
 */
export async function closeLangWatchQLService(): Promise<void> {
  const previous = cached;
  cached = null;
  await previous?.close();
}

/**
 * Records what one query's judgements cost, or records nothing.
 *
 * Nothing when no eval function ran, and nothing when they ran but judged no
 * text: a cost row of zero is a row a customer has to read and dismiss.
 *
 * Deliberately not allowed to fail the query. The judgements were made and the
 * answer is correct; losing the cost row is an accounting problem to find in
 * the logs, not a reason to refuse a caller a result they have already been
 * charged for.
 */
async function recordInstantEvalCost({
  projectId,
  usage,
  classifier,
  recordCost,
}: {
  projectId: string;
  usage: LangWatchQLEvalUsage | undefined;
  classifier: InstantEvalClassifier;
  recordCost: LangWatchQLInstantEvalSupport["recordCost"];
}): Promise<void> {
  if (!usage || usage.inputTokens <= 0) return;
  const costUsd = instantEvalCostUsd({
    inputTokens: usage.inputTokens,
    pricing: classifier.pricing,
  });
  try {
    await recordCost({
      projectId,
      inputTokens: usage.inputTokens,
      requests: usage.requests,
      costUsd,
      priceUsd: instantEvalPriceUsd({ costUsd, pricing: classifier.pricing }),
    });
  } catch (error) {
    logger.error(
      { projectId, error },
      "Instant Evals cost row could not be written",
    );
  }
}
