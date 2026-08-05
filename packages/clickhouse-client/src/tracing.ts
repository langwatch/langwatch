/**
 * Span and metric emission for a statement.
 *
 * Written against narrow ports rather than OpenTelemetry directly. The package
 * stays dependency-free, the host wires its own tracer, and a test asserts on a
 * recorded array instead of standing up an SDK.
 *
 * What is deliberately NOT recorded: the statement text and its parameters.
 * A span is shipped to whatever backend the host configured, and neither the
 * SQL nor the bound values have been through redaction - parameters carry ids,
 * and a hand-written statement can carry literals. This package already learned
 * that lesson at a different boundary, where unparsed request bodies reached a
 * third-party processor because nobody asked what was in them. The table name,
 * the tenant and the shape of the result are enough to find a slow or failing
 * query; the text of it belongs in the code, where it already is.
 */

import type { QueryMiddleware, QueryRequest, QueryResult } from "./pipeline";

export interface SpanPort {
  setAttribute(key: string, value: string | number | boolean): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface TracerPort {
  startSpan(name: string): SpanPort;
}

export interface QueryOutcome {
  request: QueryRequest;
  durationMs: number;
  error?: unknown;
  rowCount?: number | undefined;
}

export interface TraceOptions {
  tracer: TracerPort;
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

export function trace({
  tracer,
  spanName = "clickhouse.query",
  onComplete,
  now = () => Date.now(),
}: TraceOptions): QueryMiddleware {
  return (next) =>
    async <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
      const span = tracer.startSpan(spanName);
      const startedAt = now();

      span.setAttribute(SPAN_ATTRIBUTES.system, "clickhouse");
      span.setAttribute(SPAN_ATTRIBUTES.tenant, request.tenantId);
      span.setAttribute(SPAN_ATTRIBUTES.operation, request.kind ?? "read");
      if (request.table !== undefined) {
        span.setAttribute(SPAN_ATTRIBUTES.table, request.table);
      }
      // Recorded so an audit can enumerate every statement that opted out of
      // the tenant predicate, and why, without reading the code.
      if (request.unscoped !== undefined) {
        span.setAttribute(
          SPAN_ATTRIBUTES.unscopedReason,
          request.unscoped.reason,
        );
      }

      try {
        const result = await next<Row>(request);
        span.setAttribute(SPAN_ATTRIBUTES.rows, result.rows.length);
        if (result.stats?.bytesRead !== undefined) {
          span.setAttribute(SPAN_ATTRIBUTES.bytesRead, result.stats.bytesRead);
        }
        onComplete?.({
          request,
          durationMs: now() - startedAt,
          rowCount: result.rows.length,
        });
        return result;
      } catch (error) {
        span.recordError(error);
        onComplete?.({ request, durationMs: now() - startedAt, error });
        throw error;
      } finally {
        span.end();
      }
    };
}
