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

import type { QueryRequest, QueryResult } from "./query";

/**
 * A failure, reduced to what is safe to ship.
 *
 * Deliberately not the error itself. A ClickHouse server error embeds the
 * failing statement in its message ("...(in query: SELECT ...)"), so handing
 * the raw error to a span backend re-opens the very hole the no-SQL rule above
 * closes - and does it on the failure path, where nobody looks until later.
 * The class and the server's error code are enough to group and alert on.
 */
export interface QueryErrorDescriptor {
  name: string;
  code?: string | undefined;
  status?: number | undefined;
}

export interface SpanPort {
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

/**
 * Runs host observability code without letting it change the outcome.
 *
 * Everything this middleware calls - the tracer, the span, the completion
 * counter - is supplied by the host and runs on the query's own path. An
 * exception from any of it would surface to the caller as though the query had
 * failed, or would replace a real ClickHouse error with a telemetry one. A
 * span exporter that is misconfigured is a reporting problem; it must not
 * become an outage.
 */
function quietly(report: () => void): void {
  try {
    report();
  } catch {
    // Deliberately swallowed. The only channel for reporting a telemetry
    // failure is the telemetry that just failed.
  }
}

/**
 * Records one span per statement.
 *
 * {@link ClickHouseQueryClient} runs this *outside* the concurrency limiter, so
 * time spent waiting for a slot falls inside the span. That wait is latency the
 * caller experienced; a span opened after it would report a fast query on a
 * slow request.
 *
 * Every interaction with the host tracer is wrapped in `quietly`: a broken
 * tracer must not be able to fail a query that would otherwise have succeeded.
 */
export class QueryTracer {
  private readonly tracer: TracerPort;
  private readonly spanName: string;
  private readonly onComplete: TraceOptions["onComplete"];
  private readonly now: () => number;

  constructor({
    tracer,
    spanName = "clickhouse.query",
    onComplete,
    now = () => Date.now(),
  }: TraceOptions) {
    this.tracer = tracer;
    this.spanName = spanName;
    this.onComplete = onComplete;
    this.now = now;
  }

  /** Run `task` inside a span describing `request`. */
  async trace<Row>(
    request: QueryRequest,
    task: () => Promise<QueryResult<Row>>,
  ): Promise<QueryResult<Row>> {
    let span: SpanPort | undefined;
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
        span.setAttribute(
          SPAN_ATTRIBUTES.unscopedReason,
          request.unscoped.reason,
        );
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
