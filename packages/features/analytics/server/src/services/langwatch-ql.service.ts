/**
 * Orders catalog-derived policy, validation, reserved-window resolution, restricted execution, then advisory diagnostics. It
 * does not recreate their decisions. Database row policy is the isolation boundary; this service is defence in depth. Server
 * ceilings throw coded errors, result ceilings truncate and mark the response, and neither is caller-controlled.
 */

import { createLogger } from "@langwatch/observability";
import type {
  LangWatchQLBudgetOverflowMode,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLSchema,
} from "@langwatch/analytics-contract";
import { LangWatchQLCapabilityService } from "./langwatch-ql-capability.service.ts";

import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLDiagnosticsService } from "./langwatch-ql-diagnostics.service.ts";
import {
  LangWatchQLParameterMissingError,
  LangWatchQLUnavailableError,
} from "@langwatch/analytics-contract";
import { DEFAULT_LWQL_RESULT_LIMITS } from "./langwatch-ql-executor.service.ts";
import type {
  LangWatchQLExecutorPort,
  LangWatchQLResultLimits,
} from "../ports/langwatch-ql-executor.port.ts";
import {
  type LangWatchQLGranularityResolution,
  LangWatchQLTimeWindowService,
} from "./langwatch-ql-time-window.service.ts";
import { LangWatchQLSchemaService } from "./langwatch-ql-schema.service.ts";
import type { LangWatchQLTimeWindow } from "@langwatch/analytics-contract";
import { LWQL_PERIOD_GRANULARITY_PARAMETER } from "@langwatch/analytics-contract";
import { LangWatchQLValidationErrorService } from "./langwatch-ql-validation-errors.service.ts";
import type { AcceptedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";
import { LangWatchQLValidationService } from "./langwatch-ql-validation.service.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();

const lwqlCapability = LangWatchQLCapabilityService.create();
const timeWindows = LangWatchQLTimeWindowService.create();
const lwqlSchema = LangWatchQLSchemaService.create();
const lwqlDiagnostics = LangWatchQLDiagnosticsService.create();
const lwqlValidationErrors = LangWatchQLValidationErrorService.create();

const logger = createLogger("langwatch:analytics:lwql");

/**
 * The run-path half of the reserved-parameter contract, as one step: resolve what the caller's window and step
 * mean for this request, then refuse when any declared reserved name would still reach the database without a
 * value — one refusal naming everything the surface forgot rather than only its first omission.
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
  readonly declared: Parameters<LangWatchQLTimeWindowService["resolveGranularity"]>[0]["declared"];
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
  // Caller-owned doors resolve the granularity contract with refuse on overflow: whoever is
  // asking picked the step, so coarsening it for them would change the answer they asked
  // for. A surface that picked the step on the member's behalf rather than at their request
  // — the dashboard, whose period is dragged around by a control the widget does not own —
  // passes "coarsen" instead, and reports the substitution rather than hiding it.
  const granularity = timeWindows.resolveGranularity({
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
  readonly protections: LangWatchQLProtections;
  /** The SQL exactly as submitted. */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /**
   * The period the surface is showing, supplied by the surface and never by the caller's own parameters. Injected
   * into the reserved names the statement declares, and ignored by a statement that declares neither.
   * @see ./timeWindow.ts
   */
  readonly timeWindow?: LangWatchQLTimeWindow;
  /**
   * The datapoint step the surface chose, in seconds, for a statement that
   * declares `{period_granularity_seconds:UInt32}`. Injected like the window.
   */
  readonly granularitySeconds?: number;
  /**
   * What to do when the period at the chosen step would exceed the bucket
   * ceiling. Defaults to `"refuse"`.
   */
  readonly onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
}

/**
 * A statement that passed the gate, plus what the surface's time window means
 * for it.
 */
export interface ValidatedLangWatchQL extends AcceptedLangWatchQL {
  /** Whether the statement declares the reserved time-window parameters. */
  readonly followsTimeWindow: boolean;
  /**
   * The values to execute with — the caller's, plus the window this surface
   * injected for the reserved names the statement declares.
   */
  readonly boundParameters?: Readonly<Record<string, unknown>>;
  /** Reserved names the statement declares that no window filled. */
  readonly awaitingTimeWindow: readonly string[];
}

export interface LangWatchQLServiceDependencies {
  /**
   * How queries reach the database, or `null` on a deployment with no LangWatchQL
   * identity provisioned — in which case every query is refused rather than run
   * with weaker guarantees.
   */
  readonly executor: LangWatchQLExecutorPort | null;
  /** Database the LangWatchQL views live in, and what unqualified names resolve to. */
  readonly database: string;
  readonly views?: readonly LangWatchQLViewDefinition[];
  readonly limits?: LangWatchQLResultLimits;
  /** The clock the diagnostics ask "has this period finished yet" against. */
  readonly now?: () => Date;
}

export class LangWatchQLService {
  private readonly views: readonly LangWatchQLViewDefinition[];
  private readonly limits: LangWatchQLResultLimits;
  private readonly now: () => Date;
  private readonly validation = LangWatchQLValidationService.create();

  /** Releases the transport the executor holds, where it holds one. */
  async close(): Promise<void> {
    await this.deps.executor?.close();
  }

  private constructor(private readonly deps: LangWatchQLServiceDependencies) {
    this.views = deps.views ?? LWQL_VIEW_CATALOG;
    this.limits = deps.limits ?? DEFAULT_LWQL_RESULT_LIMITS;
    this.now = deps.now ?? (() => new Date());
  }

  static create(deps: LangWatchQLServiceDependencies): LangWatchQLService {
    return new LangWatchQLService(deps);
  }

  /** Whether this deployment has a LangWatchQL identity to run a query as. */
  get available(): boolean {
    return this.deps.executor != null;
  }

  /** The LangWatchQL schema this caller's permissions unlock. */
  describeSchema({ protections }: { protections: LangWatchQLProtections }): LangWatchQLSchema {
    return lwqlSchema.describe({
      database: this.deps.database,
      protections,
      views: this.views,
    });
  }

  /**
   * Decides whether a statement may run for these permissions, without running
   * it — steps 2 and 3 of the order this file documents.
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
    readonly protections: LangWatchQLProtections;
    readonly sql: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    /** The period the surface is showing, when one is asking. */
    readonly timeWindow?: LangWatchQLTimeWindow;
  }): ValidatedLangWatchQL {
    const validation = this.validation.validate({
      sql,
      // The datasets this caller can reach, not every dataset the catalog has. A dataset gated
      // as a whole is absent from the schema endpoint, and `allowedTables` is what makes it
      // *unnameable* rather than merely unlisted: derived from the full catalog, a caller could
      // name a hidden dataset and read its row-policed rows despite holding none of the
      // permissions that dataset requires.
      allowedTables: catalogShapes.allowedTables({
        database: this.deps.database,
        views: catalogShapes.visibleViews({ protections, views: this.views }),
      }),
      // Derived from the *full* catalog on purpose: a column of a hidden
      // dataset must stay gated so that naming it unqualified — where no table
      // reference reveals which dataset it came from — is refused too.
      gatedColumns: catalogShapes.gatedColumns({ protections, views: this.views }),
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

      throw lwqlValidationErrors.forRejection(validation);
    }

    // The granularity rules ride on every validate -- persisted saves AND
    // ad-hoc execution, since execute() calls validate() -- which is what
    // makes REST saves, tRPC saves and workbench runs refuse identically.
    timeWindows.assertGranularityDeclaration(validation.parameters);

    // Before the missing-parameter check, never after: an injected window IS a
    // value, and checking first would refuse every period-aware statement for
    // the two names the surface was about to supply.
    const window = timeWindows.resolveTimeWindow({
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
    if (missing.length > 0) {
      throw new LangWatchQLParameterMissingError(missing);
    }

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
   */
  private async executeValidated({
    executor,
    project,
    sql,
    validation,
    granularity,
  }: {
    readonly executor: LangWatchQLExecutorPort;
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
      tenantCapability: lwqlCapability.tenantCapability({
        secret: project.lwqlKey,
      }),
      limits: this.limits,
    });

    // The facts the walk recorded, plus what actually came back. Both halves
    // are needed and neither is re-derived: a rule about the query's shape
    // reads `validation`, a rule about the answer reads the rows.
    const diagnostics = lwqlDiagnostics.diagnose({
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
