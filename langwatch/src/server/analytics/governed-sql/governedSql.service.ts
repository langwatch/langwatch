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
 *  3. Validate. A refusal is thrown as the validator's own handled error and
 *     the query never reaches the database.
 *  4. Execute as the restricted identity, carrying the caller's tenant
 *     capability as the one setting the profile lets a query change.
 *  5. Shape the result, marking any ceiling that cut it short.
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

import { GOVERNED_VIEW_CATALOG } from "./catalog/governedViews";
import {
  type GovernedViewDefinition,
  governedAllowedTables,
  governedGatedColumns,
} from "./catalog/types";
import { governedTenantCapability } from "./capability";
import { GovernedSqlParameterMissingError, GovernedSqlUnavailableError } from "./errors";
import {
  DEFAULT_GOVERNED_SQL_RESULT_LIMITS,
  type GovernedSqlColumn,
  type GovernedSqlExecutor,
  type GovernedSqlResultLimits,
  type GovernedSqlStatistics,
  createGovernedSqlExecutor,
  governedSqlConnectionFromEnv,
} from "./executor";
import { describeGovernedSchema, type GovernedSchema } from "./schema";
import { governedSqlValidationError } from "./validation/errors";
import { validateGovernedSql } from "./validation/validate";

import type { Protections } from "../../traces/protections";

const logger = createLogger("langwatch:analytics:governed-sql");

/**
 * A structured note about a result that is correct but worth reading twice.
 *
 * Distinct from an error: the query ran and the answer is real. The union has
 * one member today; the diagnostics slice adds the rest
 * (`POSSIBLE_FANOUT`, comparison-period, missing-time-buckets).
 */
export interface GovernedSqlDiagnostic {
  readonly code: "RESULT_TRUNCATED";
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** What a caller gets back from the query endpoint. */
export interface GovernedSqlQueryResult {
  readonly columns: readonly GovernedSqlColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: GovernedSqlStatistics;
  /** Whether a result ceiling cut the answer short. */
  readonly truncated: boolean;
  /**
   * Notes about the result. Empty means no known issue was detected, which is
   * not the same as a guarantee the answer is what the caller meant.
   */
  readonly diagnostics: readonly GovernedSqlDiagnostic[];
}

/** The tenant a query runs for. Only these two fields are ever needed. */
export interface GovernedSqlCaller {
  /** Project id. Used for logging; the database resolves the tenant itself. */
  readonly id: string;
  /** The project's API key, hashed into the tenant capability. Never logged. */
  readonly apiKey: string;
}

export interface GovernedSqlExecuteInput {
  readonly project: GovernedSqlCaller;
  /** Resolved server-side from the authenticated context. */
  readonly protections: Protections;
  /** The SQL exactly as submitted. */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
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

  constructor(private readonly deps: GovernedSqlServiceDependencies) {
    this.views = deps.views ?? GOVERNED_VIEW_CATALOG;
    this.limits = deps.limits ?? DEFAULT_GOVERNED_SQL_RESULT_LIMITS;
  }

  /**
   * The governed schema this caller's permissions unlock.
   *
   * Needs no executor: the schema is the catalog, and a deployment with no
   * governed identity can still describe what the API would expose. Answering
   * it does not disclose anything a caller could not read in the docs.
   */
  describeSchema({ protections }: { protections: Protections }): GovernedSchema {
    return describeGovernedSchema({
      database: this.deps.database,
      protections,
      views: this.views,
    });
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
  }: GovernedSqlExecuteInput): Promise<GovernedSqlQueryResult> {
    const validation = validateGovernedSql({
      sql,
      allowedTables: governedAllowedTables({
        database: this.deps.database,
        views: this.views,
      }),
      gatedColumns: governedGatedColumns({ protections, views: this.views }),
      defaultDatabase: this.deps.database,
    });

    if (!validation.ok) {
      logger.info(
        {
          projectId: project.id,
          violations: validation.violations.map((violation) => violation.code),
        },
        "governed SQL refused by policy",
      );
      throw governedSqlValidationError(validation);
    }

    const missing = validation.parameters
      .map((parameter) => parameter.name)
      .filter((name) => parameters?.[name] === undefined)
      .sort();
    if (missing.length > 0) throw new GovernedSqlParameterMissingError(missing);

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
      ...(parameters ? { parameters } : {}),
      tenantCapability: governedTenantCapability({ apiKey: project.apiKey }),
      limits: this.limits,
    });

    logger.info(
      {
        projectId: project.id,
        tables: validation.tables,
        rowsReturned: execution.statistics.rowsReturned,
        rowsRead: execution.statistics.rowsRead,
        elapsedMs: execution.statistics.elapsedMs,
        truncated: execution.truncated,
      },
      "governed SQL executed",
    );

    return {
      columns: execution.columns,
      rows: execution.rows,
      statistics: execution.statistics,
      truncated: execution.truncated,
      diagnostics: execution.truncated
        ? [
            {
              code: "RESULT_TRUNCATED",
              message:
                "The result was cut off at this API's response ceiling. Aggregate further, or narrow the query, to see the whole answer.",
              meta: {
                maxRows: this.limits.maxRows,
                maxResultBytes: this.limits.maxResultBytes,
                rowsReturned: execution.statistics.rowsReturned,
              },
            },
          ]
        : [],
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
 * The seam the endpoint suite wires a Testcontainers-provisioned executor
 * through, and the seam a deployment slice will wire the real one through.
 */
export function setGovernedSqlService(service: GovernedSqlService | null): void {
  cached = service;
}
