/**
 * Orders catalog-derived policy, validation, reserved-window resolution,
 * restricted execution, then advisory diagnostics. It does not recreate their
 * decisions. Database row policy is the isolation boundary; this service is
 * defence in depth. Server ceilings throw coded errors, result ceilings truncate
 * and mark the response, and neither is caller-controlled.
 */

import { createLogger } from "@langwatch/observability";
import type {
  LangWatchQLBudgetOverflowMode,
  LangWatchQLQueryResult,
  LangWatchQLSchema,
} from "@langwatch/analytics-contract";
import type { Protections } from "@langwatch/trace-server";
import { lwqlTenantCapability } from "./capability";
import { LWQL_VIEW_CATALOG } from "./catalog/lwqlViews";
import {
  type LangWatchQLViewDefinition,
  lwqlAllowedTables,
  lwqlGatedColumns,
  lwqlVisibleViews,
} from "./catalog/types";
import { lwqlDiagnostics } from "./diagnostics";
import { LangWatchQLParameterMissingError, LangWatchQLUnavailableError } from "./errors";
import {
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  type LangWatchQLExecutor,
  type LangWatchQLResultLimits,
  lwqlConnectionFromEnv,
} from "./executor";
import {
  assertLangWatchQLGranularityDeclaration,
  type LangWatchQLGranularityResolution,
  resolveLangWatchQLGranularity,
  resolveLangWatchQLTimeWindow,
} from "./resolveTimeWindow";
import { describeLangWatchQLSchema } from "./schema";
import type { LangWatchQLTimeWindow } from "@langwatch/analytics-contract";
import { LWQL_PERIOD_GRANULARITY_PARAMETER } from "@langwatch/analytics-contract";
import { lwqlValidationError } from "./validation/errors";
import { type AcceptedLangWatchQL, validateLangWatchQL } from "./validation/validate";

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
  readonly declared: Parameters<typeof resolveLangWatchQLGranularity>[0]["declared"];
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
    ...awaitingTimeWindow.filter((name) => name !== LWQL_PERIOD_GRANULARITY_PARAMETER),
    ...(granularity.followsGranularity && granularity.granularitySeconds === undefined
      ? [LWQL_PERIOD_GRANULARITY_PARAMETER]
      : []),
  ].sort();
  if (unfilledReserved.length > 0) {
    throw new LangWatchQLParameterMissingError(unfilledReserved);
  }

  return granularity;
}

export type { LangWatchQLQueryResult } from "@langwatch/analytics-contract";

/** The tenant a query runs for. Only these two fields are ever needed. */
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
  readonly project: LangWatchQLCaller;
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
   * declares `{period_granularity_seconds:UInt32}`. Injected like the window.
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
  readonly limits?: LangWatchQLResultLimits;
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
    this.limits = deps.limits ?? DEFAULT_LWQL_RESULT_LIMITS;
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
  describeSchema({ protections }: { protections: Protections }): LangWatchQLSchema {
    return describeLangWatchQLSchema({
      database: this.deps.database,
      protections,
      views: this.views,
    });
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
  }: {
    /** Logged with a refusal. The database, not this, decides the tenant. */
    readonly projectId: string;
    readonly protections: Protections;
    readonly sql: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    /** The period the surface is showing, when one is asking. */
    readonly timeWindow?: LangWatchQLTimeWindow;
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
    project,
    protections,
    sql,
    parameters,
    timeWindow,
    granularitySeconds,
    onBudgetOverflow,
  }: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    const validation = this.validate({
      projectId: project.id,
      protections,
      sql,
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
        { projectId: project.id },
        "LangWatchQL query refused: no restricted identity is provisioned",
      );
      throw new LangWatchQLUnavailableError();
    }

    return await this.executeValidated({
      executor,
      project,
      sql,
      validation,
      granularity,
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
  private async executeValidated({
    executor,
    project,
    sql,
    validation,
    granularity,
  }: {
    readonly executor: LangWatchQLExecutor;
    readonly project: LangWatchQLCaller;
    readonly sql: string;
    readonly validation: ValidatedLangWatchQL;
    readonly granularity: LangWatchQLGranularityResolution;
  }): Promise<LangWatchQLQueryResult> {
    // The resolved record plus the step this run was bucketed at, when the
    // statement declares the parameter. Built unconditionally and omitted when
    // empty, so an unparameterised query keeps the request shape it had.
    const executionParameters = {
      ...validation.boundParameters,
      ...(granularity.granularitySeconds === undefined
        ? {}
        : {
            [LWQL_PERIOD_GRANULARITY_PARAMETER]: granularity.granularitySeconds,
          }),
    };

    const execution = await executor.execute({
      sql,
      // The resolved record, not the caller's: it is the one carrying the
      // window this surface injected AND the step this run was bucketed at.
      // `validation.boundParameters` is the wrong half — it predates the
      // granularity merge, so passing it drops `period_granularity_seconds`
      // from every statement that declares one.
      ...(Object.keys(executionParameters).length > 0 ? { parameters: executionParameters } : {}),
      tenantCapability: lwqlTenantCapability({
        secret: project.lwqlKey,
      }),
      limits: this.limits,
    });

    // The facts the walk recorded, plus what actually came back. Both halves
    // are needed and neither is re-derived: a rule about the query's shape
    // reads `validation`, a rule about the answer reads the rows.
    const diagnostics = lwqlDiagnostics({
      validation,
      database: this.deps.database,
      views: this.views,
      columns: execution.columns,
      rows: execution.rows,
      truncated: execution.truncated,
      limits: this.limits,
      rowsReturned: execution.statistics.rowsReturned,
      now: this.now(),
    });

    logger.info(
      {
        projectId: project.id,
        tables: validation.tables,
        rowsReturned: execution.statistics.rowsReturned,
        rowsRead: execution.statistics.rowsRead,
        elapsedMs: execution.statistics.elapsedMs,
        truncated: execution.truncated,
        diagnostics: diagnostics.map((diagnostic) => diagnostic.code),
        followsTimeWindow: validation.followsTimeWindow,
        followsGranularity: granularity.followsGranularity,
      },
      "LangWatchQL executed",
    );

    return {
      columns: execution.columns,
      rows: execution.rows,
      statistics: execution.statistics,
      truncated: execution.truncated,
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
export function setLangWatchQLService(service: LangWatchQLService | null): void {
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
