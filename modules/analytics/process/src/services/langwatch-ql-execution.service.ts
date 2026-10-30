/**
 * Runs a LangWatchQL statement that passed every gate as the restricted identity, then shapes
 * the answer: byte ceiling, hydration and judging, diagnostics. Gates live in the caller.
 */

import {
  LangWatchQLResultTooLargeError,
  type LangWatchQLCaller,
  type LangWatchQLMemberWindow,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLRunTelemetry,
  type LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type {
  LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
  LangWatchQLResultLimits,
} from "../repositories/langwatch-ql-executor.repository.ts";
import { hydratableProjects, scopeLangWatchQL } from "../rules/langwatch-ql-query-scope.rules.ts";
import { langWatchQLTelemetryFields } from "../rules/langwatch-ql-run-telemetry.rules.ts";
import {
  langWatchQLExecutionParameters,
  langWatchQLRowLimitedSql,
  type ValidatedLangWatchQL,
} from "../rules/langwatch-ql-validation-shape.rules.ts";
import type { LangWatchQLViewDefinition } from "./langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLDiagnosticsService } from "./langwatch-ql-diagnostics.service.ts";
import type { LangWatchQLExtractionService } from "./langwatch-ql-extraction.service.ts";
import type { LangWatchQLRunTelemetryService } from "./langwatch-ql-run-telemetry.service.ts";
import type { LangWatchQLGranularityResolution } from "./langwatch-ql-time-window.service.ts";

const lwqlDiagnostics = LangWatchQLDiagnosticsService.create();

const logger = createLogger("langwatch:analytics:lwql");

type LangWatchQLExecutionDependencies = {
  readonly database: string;
  readonly views: readonly LangWatchQLViewDefinition[];
  readonly limits: LangWatchQLResultLimits;
  /** The clock the diagnostics ask "has this period finished yet" against. */
  readonly now: () => Instant;
  /** Milliseconds on a monotonic clock, for the elapsed time hydration and judging add. */
  readonly stopwatch: () => number;
  readonly extraction: Pick<LangWatchQLExtractionService, "hydrate">;
  /** Counts each answered run; the app's one instance, which counts its doors' refusals too. */
  readonly runTelemetry: Pick<LangWatchQLRunTelemetryService, "recordAnswered">;
};

type LangWatchQLExecutionInput = {
  readonly executor: LangWatchQLExecutorRepository;
  readonly projects: readonly LangWatchQLCaller[];
  readonly protections: LangWatchQLProtections;
  readonly sql: string;
  readonly validation: ValidatedLangWatchQL;
  readonly granularity: LangWatchQLGranularityResolution;
  readonly tenantCapability: string;
  /** An aggregate's members and where each is read from; absent on a plain project. */
  readonly memberWindows?: readonly LangWatchQLMemberWindow[];
  /** The window the statement follows, which bounds the origin lookup; absent, none does. */
  readonly timeWindow?: LangWatchQLTimeWindow;
  readonly signal?: AbortSignal;
  /** Who ran it: the caller and the widget's ids on the log line, the caller on the metrics. */
  readonly telemetry?: LangWatchQLRunTelemetry | undefined;
};

export class LangWatchQLExecutionService {
  /** Builds the runner over the deployment's database, views, limits and clocks. */
  static create(deps: LangWatchQLExecutionDependencies): LangWatchQLExecutionService {
    return new LangWatchQLExecutionService(deps);
  }

  private constructor(private readonly deps: LangWatchQLExecutionDependencies) {}

  /**
   * Runs a statement that passed every gate as the restricted identity, and
   * shapes what came back with the facts those gates recorded.
   */
  async execute({
    projects,
    protections,
    signal,
    telemetry,
    ...run
  }: LangWatchQLExecutionInput): Promise<LangWatchQLQueryResult> {
    const { database, views } = this.deps;
    const { validation, granularity, memberWindows } = run;
    const execution = await this.runRestricted(run);
    const hydrationStartedMs = this.deps.stopwatch();
    const answer = await this.deps.extraction.hydrate({
      projects: hydratableProjects({ projects, memberWindows }),
      protections,
      validation,
      execution,
      ...(signal ? { signal } : {}),
    });
    // The database's own time plus what hydration spent reading and judging: a judged query
    // that took three seconds must not report the sixty milliseconds ClickHouse saw of it.
    const elapsedMs =
      execution.statistics.elapsedMs + Math.round(this.deps.stopwatch() - hydrationStartedMs);

    // The facts the walk recorded, plus what actually came back. Both halves
    // are needed and neither is re-derived: a rule about the query's shape
    // reads `validation`, a rule about the answer reads the rows.
    const diagnostics = lwqlDiagnostics.diagnose({
      validation,
      database,
      views,
      columns: answer.columns,
      rows: answer.rows,
      now: this.deps.now(),
      ...(answer.appFunctions ? { appFunctions: answer.appFunctions } : {}),
    });

    const outcome = this.deps.runTelemetry.recordAnswered({
      telemetry,
      rowsReturned: answer.rows.length,
      rowsRead: execution.statistics.rowsRead,
      elapsedMs,
    });
    logger.info(
      {
        ...langWatchQLTelemetryFields({ telemetry, sql: run.sql }),
        outcome,
        projectIds: projects.map((project) => project.id),
        tables: validation.tables,
        rowsReturned: answer.rows.length,
        rowsRead: execution.statistics.rowsRead,
        elapsedMs,
        diagnostics: diagnostics.map((diagnostic) => diagnostic.code),
        followsTimeWindow: validation.followsTimeWindow,
        followsGranularity: granularity.followsGranularity,
        followsSources: validation.followsSources,
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
    };
  }

  /** The statement as the database runs it, refused when its rows outgrow `maxResultBytes`. */
  private async runRestricted({
    executor,
    sql,
    validation,
    granularity,
    tenantCapability,
    memberWindows,
    timeWindow,
  }: Omit<
    LangWatchQLExecutionInput,
    "projects" | "protections" | "signal"
  >): Promise<LangWatchQLExecutionResult> {
    const { database, views, limits } = this.deps;
    // The resolved record plus the step this run was bucketed at, when the
    // statement declares the parameter. Built unconditionally and omitted when
    // empty, so an unparameterised query keeps the request shape it had.
    const executionParameters = langWatchQLExecutionParameters({ validation, granularity });

    const execution = await executor.execute({
      // The submitted statement with a default `LIMIT` when the caller named none, so an
      // unbounded query is capped rather than streamed.
      sql: scopeLangWatchQL({
        sql: langWatchQLRowLimitedSql({ sql, validation, maxRows: limits.maxRows }),
        database,
        views,
        ...(timeWindow ? { timeWindow } : {}),
        ...(memberWindows ? { memberWindows } : {}),
      }),
      // The resolved record, not the caller's: it is the one carrying the
      // window this surface injected AND the step this run was bucketed at.
      // `validation.boundParameters` is the wrong half: it predates the
      // granularity merge, so passing it drops `period_granularity_seconds`.
      ...(Object.keys(executionParameters).length > 0 ? { parameters: executionParameters } : {}),
      tenantCapability,
    });
    // Refused rather than cut: a body that looks whole but is missing its tail is the worse
    // failure for an analytics caller. The row count is already bounded by the LIMIT above.
    this.assertResultWithinByteCeiling({ rows: execution.rows });
    return execution;
  }

  /** @throws {LangWatchQLResultTooLargeError} when the rows' JSON exceeds `maxResultBytes`. */
  private assertResultWithinByteCeiling({
    rows,
  }: {
    readonly rows: readonly Record<string, unknown>[];
  }): void {
    const { maxResultBytes } = this.deps.limits;
    let bytes = 0;
    for (const row of rows) {
      bytes += JSON.stringify(row)?.length ?? 0;
      if (bytes > maxResultBytes) {
        throw new LangWatchQLResultTooLargeError(maxResultBytes);
      }
    }
  }
}
