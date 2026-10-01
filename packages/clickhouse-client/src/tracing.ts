/**
 * Span and metric emission for a statement, against narrow ports so the
 * package stays dependency-free. Deliberately does NOT record the statement
 * text or parameters, since neither is redacted and could leak ids or literals.
 */

import { nowInstant } from "@langwatch/time";

import { quietly } from "./observability.ts";
import type { QueryRequest, QueryResult } from "./query.ts";

/**
 * A failure, reduced to what is safe to ship — never the raw error, since a
 * ClickHouse server error embeds the failing statement in its message. The
 * class and the server's error code are enough to group and alert on.
 */
export interface QueryErrorDescriptor {
  name: string;
  code?: string | undefined;
  status?: number | undefined;
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordError(error: QueryErrorDescriptor): void;
  end(): void;
}

/** Strips a failure down to {@link QueryErrorDescriptor}. Never the message. */
export function describeQueryError(error: unknown): QueryErrorDescriptor {
  if (typeof error !== "object" || error === null) {
    return { name: typeof error };
  }
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  const status = candidate.statusCode ?? candidate.status;
  return {
    name: typeof candidate.name === "string" ? candidate.name : "Error",
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    ...(typeof status === "number" ? { status } : {}),
  };
}

export interface Tracer {
  startSpan(name: string): Span;
}

export interface QueryOutcome {
  request: QueryRequest;
  durationMs: number;
  error?: unknown;
  rowCount?: number | undefined;
}

export interface TraceOptions {
  tracer: Tracer;
  /** Defaults to `clickhouse.query`. */
  spanName?: string | undefined;
  /** Called on every completion, success or failure. For counters. */
  onComplete?: ((outcome: QueryOutcome) => void) | undefined;
  /** Injectable so a test can assert an exact duration. */
  now?: (() => number) | undefined;
}

export const SPAN_ATTRIBUTES = {
  system: "db.system",
  table: "db.sql.table",
  operation: "db.operation",
  tenant: "langwatch.tenant_id",
  unscopedReason: "langwatch.unscoped_reason",
  rows: "db.response.returned_rows",
  bytesRead: "db.response.read_bytes",
} as const;

/**
 * Records one span per statement. Runs *outside* the concurrency limiter so
 * queueing latency falls inside the span, and every tracer call is wrapped
 * in `quietly` — a broken tracer must never fail an otherwise-good query.
 */
export class QueryTracer {
  private readonly tracer: Tracer;
  private readonly spanName: string;
  private readonly onComplete: TraceOptions["onComplete"];
  private readonly now: () => number;

  constructor({
    tracer,
    spanName = "clickhouse.query",
    onComplete,
    now = () => nowInstant().epochMilliseconds,
  }: TraceOptions) {
    this.tracer = tracer;
    this.spanName = spanName;
    this.onComplete = onComplete;
    this.now = now;
  }

  /** Run `task` inside a span describing `request`. */
  async trace<Row>({
    request,
    task,
  }: {
    request: QueryRequest;
    task: () => Promise<QueryResult<Row>>;
  }): Promise<QueryResult<Row>> {
    let span: Span | undefined;
    quietly(() => {
      span = this.tracer.startSpan(this.spanName);
    });
    const startedAt = this.now();

    quietly(() => {
      if (span === undefined) return;
      span.setAttribute(SPAN_ATTRIBUTES.system, "clickhouse");
      span.setAttribute(SPAN_ATTRIBUTES.tenant, request.tenantId);
      span.setAttribute(SPAN_ATTRIBUTES.operation, request.kind ?? "read");
      if (request.table !== undefined) {
        span.setAttribute(SPAN_ATTRIBUTES.table, request.table);
      }
      // Recorded so an audit can enumerate every statement that opted out of
      // the tenant predicate, and why, without reading the code.
      if (request.unscoped !== undefined) {
        span.setAttribute(SPAN_ATTRIBUTES.unscopedReason, request.unscoped.reason);
      }
    });

    try {
      const result = await task();
      quietly(() => {
        span?.setAttribute(SPAN_ATTRIBUTES.rows, result.rows.length);
        if (result.stats?.bytesRead !== undefined) {
          span?.setAttribute(SPAN_ATTRIBUTES.bytesRead, result.stats.bytesRead);
        }
        this.onComplete?.({
          request,
          durationMs: this.now() - startedAt,
          rowCount: result.rows.length,
        });
      });
      return result;
    } catch (error) {
      quietly(() => {
        span?.recordError(describeQueryError(error));
        this.onComplete?.({
          request,
          durationMs: this.now() - startedAt,
          error,
        });
      });
      throw error;
    } finally {
      quietly(() => span?.end());
    }
  }
}
