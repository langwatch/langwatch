/**
 * Orders catalog policy, validation, reserved-window resolution, restricted execution, then
 * advisory diagnostics; the database row policy is the real isolation boundary. Nothing is cut:
 * a bare statement gets the default `LIMIT`, and an oversized result is `lwql_result_too_large`.
 */

import {
  LangWatchQLParameterMissingError,
  LangWatchQLResultTooLargeError,
  LangWatchQLUnavailableError,
  langWatchQLPassSchema,
  type LangWatchQLCaller,
  type LangWatchQLEvalGate,
  type LangWatchQLExecuteInput,
  type LangWatchQLPassInput,
  type LangWatchQLProjectSetExecuteInput,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLSchema,
  type LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { LangWatchQLHydrationService } from "../features/hydration/services/langwatch-ql-hydration.service.ts";
import type {
  LangWatchQLExecutorRepository,
  LangWatchQLResultLimits,
} from "../repositories/langwatch-ql-executor.repository.ts";
import { langWatchQLPassSql } from "../rules/langwatch-ql-pass-sql.rules.ts";
import { DEFAULT_LWQL_RESULT_LIMITS } from "../rules/langwatch-ql-result-limits.rules.ts";
import {
  langWatchQLExecutionParameters,
  langWatchQLMissingParameters,
  langWatchQLRowLimitedSql,
  type ValidatedLangWatchQL,
} from "../rules/langwatch-ql-validation-shape.rules.ts";
import type { LwqlCatalogue } from "../rules/lwql-catalogue.rules.ts";
import { LWQL_CATALOG, LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLCapabilityService } from "./langwatch-ql-capability.service.ts";
import { LangWatchQLCompletenessService } from "./langwatch-ql-completeness.service.ts";
import { LangWatchQLDiagnosticsService } from "./langwatch-ql-diagnostics.service.ts";
import { LangWatchQLExtractionService } from "./langwatch-ql-extraction.service.ts";
import { LangWatchQLSchemaService } from "./langwatch-ql-schema.service.ts";
import {
  type LangWatchQLGranularityResolution,
  LangWatchQLTimeWindowService,
} from "./langwatch-ql-time-window.service.ts";
import { LangWatchQLValidationErrorService } from "./langwatch-ql-validation-errors.service.ts";
import { LangWatchQLValidationService } from "./langwatch-ql-validation.service.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();

const lwqlCapability = LangWatchQLCapabilityService.create();
const timeWindows = LangWatchQLTimeWindowService.create();
const lwqlSchema = LangWatchQLSchemaService.create();
const lwqlDiagnostics = LangWatchQLDiagnosticsService.create();
const lwqlCompleteness = LangWatchQLCompletenessService.create();
const lwqlValidationErrors = LangWatchQLValidationErrorService.create();

const logger = createLogger("langwatch:analytics:lwql");

export interface LangWatchQLServiceDependencies {
  /**
   * How queries reach the database, or `null` on a deployment with no LangWatchQL
   * identity provisioned — in which case every query is refused rather than run
   * with weaker guarantees.
   */
  readonly executor: LangWatchQLExecutorRepository | null;
  /** Database the LangWatchQL views live in, and what unqualified names resolve to. */
  readonly database: string;
  readonly views?: readonly LangWatchQLViewDefinition[];
  /** Who may read each view's table and column; `LWQL_CATALOG` unless a test narrows it. */
  readonly catalog?: LwqlCatalogue;
  readonly limits?: LangWatchQLResultLimits;
  /** The clock the diagnostics ask "has this period finished yet" against. */
  readonly now?: () => Instant;
  /**
   * Turns the keys an app function answered with into values. Absent only in a suite measuring
   * the database's own answer, which then comes back as the database gave it.
   */
  readonly hydration?: Pick<LangWatchQLHydrationService, "hydrate">;
  /**
   * Judges the eval columns once hydration left their text in place (Alex, 2026-10-06, "Judge
   * cycle"). Absent only in a suite that judges nothing; an eval column then keeps its text.
   */
  readonly judging?: Pick<InstantEvalApi, "judgeQuery" | "getJudgeLimits">;
  /** Milliseconds on a monotonic clock, for the elapsed time hydration and judging add. */
  readonly stopwatch?: () => number;
}

export class LangWatchQLService {
  private readonly views: readonly LangWatchQLViewDefinition[];
  private readonly catalog: LwqlCatalogue;
  private readonly limits: LangWatchQLResultLimits;
  private readonly now: () => Instant;
  private readonly stopwatch: () => number;
  private readonly validation = LangWatchQLValidationService.create();
  private readonly extraction: LangWatchQLExtractionService;

  /** Releases the transport the executor holds, where it holds one. */
  async close(): Promise<void> {
    await this.deps.executor?.close();
  }

  private constructor(private readonly deps: LangWatchQLServiceDependencies) {
    this.views = deps.views ?? LWQL_VIEW_CATALOG;
    this.catalog = deps.catalog ?? LWQL_CATALOG;
    this.limits = deps.limits ?? DEFAULT_LWQL_RESULT_LIMITS;
    this.now = deps.now ?? nowInstant;
    this.stopwatch = deps.stopwatch ?? (() => performance.now());
    this.extraction = LangWatchQLExtractionService.create({
      hydration: deps.hydration,
      judging: deps.judging,
    });
  }

  static create(deps: LangWatchQLServiceDependencies): LangWatchQLService {
    return new LangWatchQLService(deps);
  }

  /** Whether this deployment has a LangWatchQL identity to run a query as. */
  get available(): boolean {
    return this.deps.executor != null;
  }

  /** The database this deployment's LangWatchQL views live in. */
  get database(): string {
    return this.deps.database;
  }

  /** The LangWatchQL schema this caller's permissions unlock. */
  describeSchema({
    protections,
    isInstantEvalsEnabled,
  }: {
    protections: LangWatchQLProtections;
    /** Whether the eval functions are published as available. */
    isInstantEvalsEnabled?: boolean;
  }): LangWatchQLSchema {
    return lwqlSchema.describe({
      database: this.deps.database,
      protections,
      views: this.views,
      catalog: this.catalog,
      isInstantEvalsEnabled: isInstantEvalsEnabled === true,
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
    isInstantEvalsEnabled,
  }: {
    /** Logged with a refusal. The database, not this, decides the tenant. */
    readonly projectId: string;
    readonly protections: LangWatchQLProtections;
    readonly sql: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    /** The period the surface is showing, when one is asking. */
    readonly timeWindow?: LangWatchQLTimeWindow;
    /**
     * Whether this caller may call an eval function. The surface answers it —
     * the flag for this project, in this caller's scope. Absent means no.
     */
    readonly isInstantEvalsEnabled?: boolean;
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
        views: catalogShapes.visibleViews({
          protections,
          views: this.views,
          catalog: this.catalog,
        }),
      }),
      // Derived from the *full* catalog on purpose: a column of a hidden
      // dataset must stay gated so that naming it unqualified — where no table
      // reference reveals which dataset it came from — is refused too.
      gatedColumns: catalogShapes.gatedColumns({ protections, views: this.views }),
      // An app function returning captured content is as restricted as a
      // column holding it, so the gate reads the same permissions.
      heldPermissions: [...catalogShapes.heldPermissions(protections)],
      isInstantEvalsEnabled: isInstantEvalsEnabled === true,
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

    const missing = langWatchQLMissingParameters({ declared: validation.parameters, window });
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
   * executes it as the restricted identity, over the one project it is bound to.
   */
  execute({
    project,
    ...input
  }: LangWatchQLExecuteInput & LangWatchQLEvalGate): Promise<LangWatchQLQueryResult> {
    return this.executeForProjects({ ...input, projects: [project] });
  }

  /**
   * Re-validates the statement with the full policy, then runs it inside the fixed wrapper its
   * pass names as the caller's restricted identity. Only the statement is walked: the wrapper
   * holds it in a subquery, where the policy would refuse a top-level app function.
   */
  async executePass({
    project,
    protections,
    sql,
    parameters,
    pass,
    isInstantEvalsEnabled,
  }: LangWatchQLPassInput & LangWatchQLEvalGate): Promise<LangWatchQLQueryResult> {
    const wrapper = langWatchQLPassSchema.parse(pass);
    const validation = this.validate({
      projectId: project.id,
      protections,
      sql,
      ...(parameters ? { parameters } : {}),
      isInstantEvalsEnabled: isInstantEvalsEnabled === true,
    });
    timeWindows.resolveRunGranularityOrRefuseUnfilled({
      declared: validation.parameters,
      ...(parameters ? { parameters } : {}),
      awaitingTimeWindow: validation.awaitingTimeWindow,
    });

    const { executor } = this.deps;
    if (!executor) {
      logger.error(
        { projectIds: [project.id] },
        "LangWatchQL pass refused: no restricted identity is provisioned",
      );

      throw new LangWatchQLUnavailableError();
    }

    const composed = langWatchQLPassSql({ sql, pass: wrapper });
    const executionParameters = { ...validation.boundParameters, ...composed.parameters };
    const execution = await executor.execute({
      sql: composed.sql,
      ...(Object.keys(executionParameters).length > 0 ? { parameters: executionParameters } : {}),
      tenantCapability: lwqlCapability.tenantCapability({ secret: project.lwqlKey }),
    });

    return {
      columns: execution.columns,
      rows: execution.rows,
      statistics: execution.statistics,
      diagnostics: [],
      followsTimeWindow: false,
      followsGranularity: false,
    };
  }

  /** The same, over every project in the set — an API key's readable projects. */
  async executeForProjects({
    projects,
    protections,
    sql,
    parameters,
    timeWindow,
    granularitySeconds,
    onBudgetOverflow,
    isInstantEvalsEnabled,
    signal,
  }: LangWatchQLProjectSetExecuteInput & LangWatchQLEvalGate): Promise<LangWatchQLQueryResult> {
    const projectIds = projects.map((project) => project.id);
    const validation = this.validate({
      projectId: projectIds.join(",") || "(none)",
      protections,
      sql,
      ...(parameters ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      isInstantEvalsEnabled: isInstantEvalsEnabled === true,
    });
    const granularity = timeWindows.resolveRunGranularityOrRefuseUnfilled({
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
        { projectIds },
        "LangWatchQL query refused: no restricted identity is provisioned",
      );

      throw new LangWatchQLUnavailableError();
    }

    return this.executeValidated({
      executor,
      projects,
      protections,
      sql,
      validation,
      granularity,
      ...(timeWindow ? { timeWindow } : {}),
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Runs a statement that passed every gate as the restricted identity, and
   * shapes what came back with the facts those gates recorded.
   */
  /** @throws {LangWatchQLResultTooLargeError} when the rows' JSON exceeds `maxResultBytes`. */
  private assertResultWithinByteCeiling(rows: readonly Record<string, unknown>[]): void {
    let bytes = 0;
    for (const row of rows) {
      bytes += JSON.stringify(row)?.length ?? 0;
      if (bytes > this.limits.maxResultBytes) {
        throw new LangWatchQLResultTooLargeError(this.limits.maxResultBytes);
      }
    }
  }

  private async executeValidated({
    executor,
    projects,
    protections,
    sql,
    validation,
    granularity,
    timeWindow,
    signal,
  }: {
    readonly executor: LangWatchQLExecutorRepository;
    readonly projects: readonly LangWatchQLCaller[];
    readonly protections: LangWatchQLProtections;
    readonly sql: string;
    readonly validation: ValidatedLangWatchQL;
    readonly granularity: LangWatchQLGranularityResolution;
    readonly timeWindow?: LangWatchQLTimeWindow;
    readonly signal?: AbortSignal;
  }): Promise<LangWatchQLQueryResult> {
    // The resolved record plus the step this run was bucketed at, when the
    // statement declares the parameter. Built unconditionally and omitted when
    // empty, so an unparameterised query keeps the request shape it had.
    const executionParameters = langWatchQLExecutionParameters({ validation, granularity });
    const tenantCapability = lwqlCapability.tenantCapabilitySet({
      secrets: projects.map((project) => project.lwqlKey),
    });

    const execution = await executor.execute({
      // The submitted statement with one edit and no other: a default `LIMIT` when the caller
      // named none, so an unbounded query is capped rather than streamed.
      sql: langWatchQLRowLimitedSql({ sql, validation, maxRows: this.limits.maxRows }),
      // The resolved record, not the caller's: it is the one carrying the
      // window this surface injected AND the step this run was bucketed at.
      // `validation.boundParameters` is the wrong half — it predates the
      // granularity merge, so passing it drops `period_granularity_seconds`
      // from every statement that declares one.
      ...(Object.keys(executionParameters).length > 0 ? { parameters: executionParameters } : {}),
      tenantCapability,
    });
    // Refused rather than cut: a body that looks whole but is missing its tail is the worse
    // failure for an analytics caller. The row count is already bounded by the LIMIT above.
    this.assertResultWithinByteCeiling(execution.rows);
    const hydrationStartedMs = this.stopwatch();
    const answer = await this.extraction.hydrate({
      projects,
      protections,
      validation,
      execution,
      ...(signal ? { signal } : {}),
    });
    // The database's own time plus what hydration spent reading and judging: a judged query
    // that took three seconds must not report the sixty milliseconds ClickHouse saw of it.
    const elapsedMs =
      execution.statistics.elapsedMs + Math.round(this.stopwatch() - hydrationStartedMs);

    // The facts the walk recorded, plus what actually came back. Both halves
    // are needed and neither is re-derived: a rule about the query's shape
    // reads `validation`, a rule about the answer reads the rows.
    const diagnostics = lwqlDiagnostics.diagnose({
      validation,
      database: this.deps.database,
      views: this.views,
      columns: answer.columns,
      rows: answer.rows,
      now: this.now(),
      ...(answer.appFunctions ? { appFunctions: answer.appFunctions } : {}),
    });

    // After the main query, never beside it: a refused or failed query costs no second read.
    // Only a statement bound to the window gets a report; a hard-coded range is not the period.
    const completeness = await lwqlCompleteness.assess({
      executor,
      tenantCapability,
      validation,
      database: this.deps.database,
      views: this.views,
      ...(validation.followsTimeWindow && timeWindow ? { timeWindow } : {}),
      ...(granularity.followsGranularity && granularity.granularitySeconds !== undefined
        ? { granularitySeconds: granularity.granularitySeconds }
        : {}),
    });

    logger.info(
      {
        projectIds: projects.map((project) => project.id),
        tables: validation.tables,
        rowsReturned: answer.rows.length,
        rowsRead: execution.statistics.rowsRead,
        elapsedMs,
        diagnostics: diagnostics.map((diagnostic) => diagnostic.code),
        followsTimeWindow: validation.followsTimeWindow,
        followsGranularity: granularity.followsGranularity,
        completeness:
          completeness.kind === "reported" ? completeness.completeness.state : completeness.reason,
      },
      "LangWatchQL executed",
    );

    return {
      columns: answer.columns,
      rows: answer.rows,
      // Hydration can drop trailing rows at its own ceiling: the count is what the caller received.
      statistics: { ...execution.statistics, elapsedMs, rowsReturned: answer.rows.length },
      diagnostics,
      followsTimeWindow: validation.followsTimeWindow,
      followsGranularity: granularity.followsGranularity,
      ...(granularity.granularitySeconds === undefined
        ? {}
        : { granularitySeconds: granularity.granularitySeconds }),
      ...(granularity.coarsenedFromSeconds === undefined
        ? {}
        : { coarsenedFromSeconds: granularity.coarsenedFromSeconds }),
      ...(completeness.kind === "reported" ? { completeness: completeness.completeness } : {}),
    };
  }
}

/**
 * The `analytics.*` namespace the catalog documents, used when the deployment
 * names no other.
 */
export const DEFAULT_LWQL_DATABASE = "analytics";
