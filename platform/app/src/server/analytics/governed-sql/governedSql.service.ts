/**
 * Governed analytics SQL — the service the endpoints call.
 *
 * Composes four layers that are each proven on their own: the schema catalog
 * (`./catalog/`), the default-deny AST validator (`./validation/`), the
 * database-side access model (`./provisioning.ts`), and the execution seam
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
 *     A refusal is thrown as the validator's own handled error and the query
 *     never reaches the database.
 *  4. Execute as the restricted identity, carrying the caller's tenant
 *     capability as the one setting the profile lets a query change.
 *  5. Shape the result, and run the advisory diagnostics (`./diagnostics.ts`)
 *     over the facts step 3 recorded and the rows step 4 returned.
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
 * layer adds are about the response — how many rows, how many bytes — and they
 * truncate rather than throw, always marked. Neither can be relaxed by a
 * caller: the first because `readonly = 1` refuses the setting change, the
 * second because it is not in the request shape.
 *
 * @see specs/analytics/governed-sql-api.feature
 * @see ./provisioning.ts — the isolation this composes over
 */

import { createLogger } from "@langwatch/observability";
import type { Protections } from "../../traces/protections";
import { governedTenantCapability } from "./capability";
import { GOVERNED_VIEW_CATALOG } from "./catalog/governedViews";
import {
  type GovernedViewDefinition,
  governedAllowedTables,
  governedGatedColumns,
  governedVisibleViews,
} from "./catalog/types";
import {
  type GovernedSqlDiagnostic,
  governedSqlDiagnostics,
} from "./diagnostics";
import {
  GovernedSqlParameterMissingError,
  GovernedSqlUnavailableError,
} from "./errors";
import {
  createGovernedSqlExecutor,
  DEFAULT_GOVERNED_SQL_RESULT_LIMITS,
  type GovernedSqlColumn,
  type GovernedSqlExecutor,
  type GovernedSqlResultLimits,
  type GovernedSqlStatistics,
  governedSqlConnectionFromEnv,
} from "./executor";
import { resolveGovernedTimeWindow } from "./resolveTimeWindow";
import { describeGovernedSchema, type GovernedSchema } from "./schema";
import type { GovernedSqlTimeWindow } from "./timeWindow";
import { governedSqlValidationError } from "./validation/errors";
import {
  type AcceptedGovernedSql,
  validateGovernedSql,
} from "./validation/validate";

const logger = createLogger("langwatch:analytics:governed-sql");

/** What a caller gets back from the query endpoint. */
export interface GovernedSqlQueryResult {
  readonly columns: readonly GovernedSqlColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: GovernedSqlStatistics;
  /** Whether a result ceiling cut the answer short. */
  readonly truncated: boolean;
  /**
   * Notes about the result. An empty list means no known issue was detected,
   * which is not a claim that the answer is the one the caller meant — see
   * `GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING` in `./diagnostics.ts`.
   */
  readonly diagnostics: readonly GovernedSqlDiagnostic[];
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
}

/** The tenant a query runs for. Only these two fields are ever needed. */
export interface GovernedSqlCaller {
  /** Project id. Used for logging; the database resolves the tenant itself. */
  readonly id: string;
  /**
   * The project's governed SQL secret (`Project.governedSqlKey`), hashed into
   * the tenant capability. Never logged.
   */
  readonly governedSqlKey: string;
}

export interface GovernedSqlExecuteInput {
  readonly project: GovernedSqlCaller;
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
  readonly timeWindow?: GovernedSqlTimeWindow;
}

/**
 * A statement that passed the gate, plus what the surface's time window means
 * for it.
 *
 * The two extra facts are here rather than on {@link AcceptedGovernedSql}
 * because they are not properties of the parse: they depend on what the caller
 * sent and on which surface is asking.
 */
export interface ValidatedGovernedSql extends AcceptedGovernedSql {
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
   * chart. {@link GovernedSqlService.execute} is what cannot proceed with one.
   */
  readonly awaitingTimeWindow: readonly string[];
}

export interface GovernedSqlServiceDependencies {
  /**
   * How queries reach the database, or `null` on a deployment with no governed
   * identity provisioned — in which case every query is refused rather than run
   * with weaker guarantees.
   */
  readonly executor: GovernedSqlExecutor | null;
  /** Database the governed views live in, and what unqualified names resolve to. */
  readonly database: string;
  readonly views?: readonly GovernedViewDefinition[];
  readonly limits?: GovernedSqlResultLimits;
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
 * The governed analytics SQL API's application service.
 *
 * Holds no SQL of its own and opens no connection: it derives policy from the
 * catalog and hands the caller's statement, untouched, to the executor.
 */
export class GovernedSqlService {
  private readonly views: readonly GovernedViewDefinition[];
  private readonly limits: GovernedSqlResultLimits;
  private readonly now: () => Date;

  constructor(private readonly deps: GovernedSqlServiceDependencies) {
    this.views = deps.views ?? GOVERNED_VIEW_CATALOG;
    this.limits = deps.limits ?? DEFAULT_GOVERNED_SQL_RESULT_LIMITS;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Whether this deployment has a governed identity to run a query as.
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
   * The governed schema this caller's permissions unlock.
   *
   * Needs no executor: the schema is the catalog, and a deployment with no
   * governed identity can still describe what the API would expose. Answering
   * it does not disclose anything a caller could not read in the docs.
   */
  describeSchema({
    protections,
  }: {
    protections: Protections;
  }): GovernedSchema {
    return describeGovernedSchema({
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
   *   {@link GovernedSqlParameterMissingError} when a declared parameter has no
   *   value, and the two time-window refusals in `./timeWindow.ts` when a
   *   reserved name is supplied by the caller or declared as a non-date-time.
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
    readonly timeWindow?: GovernedSqlTimeWindow;
  }): ValidatedGovernedSql {
    const validation = validateGovernedSql({
      sql,
      // The datasets this caller can reach, not every dataset the catalog has.
      // A dataset gated as a whole is absent from the schema endpoint, and
      // `allowedTables` is what makes it *unnameable* rather than merely
      // unlisted: derived from the full catalog, a caller could name a hidden
      // dataset and read its row-policed rows despite holding none of the
      // permissions that dataset requires.
      allowedTables: governedAllowedTables({
        database: this.deps.database,
        views: governedVisibleViews({ protections, views: this.views }),
      }),
      // Derived from the *full* catalog on purpose: a column of a hidden
      // dataset must stay gated so that naming it unqualified — where no table
      // reference reveals which dataset it came from — is refused too.
      gatedColumns: governedGatedColumns({ protections, views: this.views }),
      defaultDatabase: this.deps.database,
    });

    if (!validation.ok) {
      logger.info(
        {
          projectId,
          violations: validation.violations.map((violation) => violation.code),
        },
        "governed SQL refused by policy",
      );
      throw governedSqlValidationError(validation);
    }

    // Before the missing-parameter check, never after: an injected window IS a
    // value, and checking first would refuse every period-aware statement for
    // the two names the surface was about to supply.
    const window = resolveGovernedTimeWindow({
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
      .sort();
    if (missing.length > 0) throw new GovernedSqlParameterMissingError(missing);

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
   *   {@link GovernedSqlParameterMissingError} when a declared parameter has no
   *   value, and {@link GovernedSqlUnavailableError} when no governed identity
   *   is provisioned.
   */
  async execute({
    project,
    protections,
    sql,
    parameters,
    timeWindow,
  }: GovernedSqlExecuteInput): Promise<GovernedSqlQueryResult> {
    const validation = this.validate({
      projectId: project.id,
      protections,
      sql,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
    });

    // A statement that asks for the period but was handed none cannot run: the
    // database would answer `UNKNOWN_QUERY_PARAMETER`, which reaches the caller
    // as an unknown 500 for something a surface can fix by sending its window.
    if (validation.awaitingTimeWindow.length > 0) {
      throw new GovernedSqlParameterMissingError(validation.awaitingTimeWindow);
    }

    // Fail closed. The check is here rather than in the constructor so that a
    // deployment with no governed identity still answers the schema endpoint,
    // and so that the refusal is a per-request handled error rather than a
    // boot-time crash of an app that mostly does other things.
    const { executor } = this.deps;
    if (!executor) {
      logger.error(
        { projectId: project.id },
        "governed SQL query refused: no restricted identity is provisioned",
      );
      throw new GovernedSqlUnavailableError();
    }

    const execution = await executor.execute({
      sql,
      // The resolved record, not the caller's: it is the one carrying the
      // window this surface injected.
      ...(validation.boundParameters
        ? { parameters: validation.boundParameters }
        : {}),
      tenantCapability: governedTenantCapability({
        secret: project.governedSqlKey,
      }),
      limits: this.limits,
    });

    // The facts the walk recorded, plus what actually came back. Both halves
    // are needed and neither is re-derived: a rule about the query's shape
    // reads `validation`, a rule about the answer reads the rows.
    const diagnostics = governedSqlDiagnostics({
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
      },
      "governed SQL executed",
    );

    return {
      columns: execution.columns,
      rows: execution.rows,
      statistics: execution.statistics,
      truncated: execution.truncated,
      diagnostics,
      followsTimeWindow: validation.followsTimeWindow,
    };
  }
}

/**
 * The `analytics.*` namespace the catalog documents, used when the deployment
 * names no other.
 */
export const DEFAULT_GOVERNED_DATABASE = "analytics";

/**
 * Builds the service from the environment.
 *
 * The database name defaults to the namespace the catalog documents, so a
 * deployment that provisions the standard objects needs only the credentials.
 */
export function createGovernedSqlService(
  overrides: Partial<GovernedSqlServiceDependencies> = {},
): GovernedSqlService {
  const connection = governedSqlConnectionFromEnv();
  return new GovernedSqlService({
    executor: connection ? createGovernedSqlExecutor(connection) : null,
    database: connection?.database ?? DEFAULT_GOVERNED_DATABASE,
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
let cached: GovernedSqlService | null = null;

/** The process-wide service, built from the environment on first use. */
export function getGovernedSqlService(): GovernedSqlService {
  cached ??= createGovernedSqlService();
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
export function setGovernedSqlService(
  service: GovernedSqlService | null,
): void {
  cached = service;
}
