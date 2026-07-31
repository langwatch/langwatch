/**
 * LWQL service — the single entry point behind both transports.
 *
 * Issue #6346 decision 5: REST and tRPC call this function. They are transports,
 * not implementations, so the two surfaces cannot drift in what they permit.
 * Anything that decides what a caller may read lives here or below.
 */

import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import { ENTITIES, fieldNames, gatedFieldNames } from "./catalog";
import { type CompiledQuery, compile } from "./compiler";
import { LwqlError } from "./errors";
import type { GatingContext } from "./gating";
import { type LwqlQuery, lwqlQuerySchema } from "./ir";
import { parseLwql } from "./parser";

const logger = createLogger("langwatch:app-layer:lwql");

/**
 * Resolves the caller's content-visibility cutoff for a project.
 *
 * `null` means the plan has no window and nothing is gated. Production wiring
 * passes `getVisibilityCutoffMsForProject`, which already fails closed on plan
 * errors; injected rather than imported so the service stays testable without a
 * plan store.
 */
export type VisibilityCutoffResolver = (
  projectId: string,
) => Promise<number | null>;

export interface LwqlRequest {
  /** SQL-like text. Mutually exclusive with `ir`. */
  query?: string;
  /** Structured IR. Mutually exclusive with `query`. */
  ir?: unknown;
}

export interface LwqlExecutionOptions {
  projectId: string;
  /** Validate and compile, but do not execute. Powers the dry-run endpoint. */
  dryRun?: boolean;
  /**
   * Include the generated SQL in the response.
   *
   * Issue #6346: `explain` is internal-only. The caller is responsible for
   * proving the requester is internal; this service will not infer it.
   */
  explain?: boolean;
  now?: number;
}

export interface LwqlResultMeta {
  row_count: number;
  execution_ms: number;
  truncated: boolean;
  columns: string[];
  /** Present only when `explain` was requested by an internal caller. */
  sql?: string;
  params?: Record<string, unknown>;
}

export interface LwqlResult {
  data: Record<string, unknown>[];
  meta: LwqlResultMeta;
}

/**
 * ClickHouse guardrails. The query surface is caller-driven, so a single
 * expensive query must not be able to degrade the cluster for other tenants.
 */
const LWQL_CLICKHOUSE_SETTINGS: ClickHouseSettings = {
  max_execution_time: 30,
  max_result_rows: "100000",
  // `readonly: 2` permits SELECT and settings changes but no writes — a
  // server-side backstop behind the language's own read-only guarantee.
  readonly: "2",
};

export class LwqlService {
  constructor(
    /**
     * Resolves a per-tenant client. May return null when ClickHouse is not
     * provisioned for a project, which the caller reports as unavailable
     * rather than treating as an empty result.
     */
    private readonly resolveClient: (
      projectId: string,
    ) => Promise<ClickHouseClient | null>,
    private readonly resolveVisibilityCutoff: VisibilityCutoffResolver,
  ) {}

  /**
   * Validates against the IR schema, which both input forms must satisfy — the
   * text parser gets no privilege the structured form lacks, and vice versa.
   */
  private validateIr(raw: unknown): LwqlQuery {
    const parsed = lwqlQuerySchema.safeParse(raw);
    if (parsed.success) return parsed.data as LwqlQuery;

    const first = parsed.error.issues[0];
    throw new LwqlError(
      "invalid_query",
      first
        ? `${first.path.join(".") || "query"}: ${first.message}`
        : "Query failed validation.",
      { hint: "Check the field names and value types against the catalogue." },
    );
  }

  /** Parses/validates a request into IR without touching the database. */
  toIr(request: LwqlRequest, now?: number): LwqlQuery {
    const hasText = typeof request.query === "string" && !!request.query.trim();
    const hasIr = request.ir !== undefined && request.ir !== null;

    if (hasText && hasIr) {
      throw new LwqlError(
        "invalid_query",
        "Provide either `query` text or a structured `ir`, not both.",
      );
    }
    if (!hasText && !hasIr) {
      throw new LwqlError("invalid_query", "No query supplied.", {
        hint: "Send `query` with SQL-like text, or `ir` with a structured query.",
      });
    }

    return this.validateIr(
      hasText ? parseLwql(request.query!, { now }) : request.ir,
    );
  }

  /**
   * Resolves gating, failing closed.
   *
   * ADR-028's service throws when plan resolution fails and leaves the fallback
   * to the caller. A transient plan-store error must not read as "no window" —
   * that would silently ungate content for every free-tier caller for the
   * duration of the outage.
   */
  private async resolveGating(projectId: string): Promise<GatingContext> {
    try {
      return { cutoffMs: await this.resolveVisibilityCutoff(projectId) };
    } catch (error) {
      // Defence in depth: the production resolver already fails closed, but a
      // resolver that throws must never read as "no window" here either.
      logger.warn(
        { error, projectId },
        "visibility cutoff resolution failed; gating content closed",
      );
      return { cutoffMs: Date.now() };
    }
  }

  async compileOnly(
    request: LwqlRequest,
    options: LwqlExecutionOptions,
  ): Promise<CompiledQuery> {
    const ir = this.toIr(request, options.now);
    const gating = await this.resolveGating(options.projectId);
    return compile(ir, {
      projectId: options.projectId,
      gating,
      now: options.now,
    });
  }

  async run(
    request: LwqlRequest,
    options: LwqlExecutionOptions,
  ): Promise<LwqlResult> {
    const started = Date.now();
    const compiled = await this.compileOnly(request, options);

    const explainFields = options.explain
      ? { sql: compiled.sql, params: compiled.params }
      : {};

    if (options.dryRun) {
      return {
        data: [],
        meta: {
          row_count: 0,
          execution_ms: Date.now() - started,
          truncated: false,
          columns: compiled.columns,
          ...explainFields,
        },
      };
    }

    const client = await this.resolveClient(options.projectId);
    if (!client) {
      throw new LwqlError(
        "invalid_query",
        "Query backend is unavailable for this project.",
      );
    }

    const result = await client.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSONEachRow",
      clickhouse_settings: LWQL_CLICKHOUSE_SETTINGS,
    });

    const rows = (await result.json()) as Record<string, unknown>[];

    // The compiler asked for `limit + 1` so truncation is observed, not guessed.
    const truncated = rows.length > compiled.limit;
    const data = truncated ? rows.slice(0, compiled.limit) : rows;

    return {
      data,
      meta: {
        row_count: data.length,
        execution_ms: Date.now() - started,
        truncated,
        columns: compiled.columns,
        ...explainFields,
      },
    };
  }
}

/**
 * Machine-readable catalogue, for editors, docs, and agents composing queries.
 * Contains no tenant data — it is the shape of the language, not of the rows.
 */
export const describeCatalogue = () =>
  Object.entries(ENTITIES).map(([name, entity]) => ({
    entity: name,
    fields: fieldNames(entity).map((field) => ({
      name: field,
      type: entity.fields[field]!.type,
      description: entity.fields[field]!.description,
      content_gated: entity.fields[field]!.contentGated === true,
    })),
    content_gated_fields: gatedFieldNames(entity),
  }));
