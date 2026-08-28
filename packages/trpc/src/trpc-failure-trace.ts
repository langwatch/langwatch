import { trace as otelTrace, type Span } from "@opentelemetry/api";

/**
 * Keeps the trace captured while a tRPC span is live until formatting happens
 * after the middleware chain unwinds. Weak keys prevent failed calls from
 * retaining request errors.
 */
export class TrpcFailureTraceIds {
  private readonly traceIds = new WeakMap<object, string>();

  remember(error: unknown, span: Span): void {
    if (error && typeof error === "object") {
      this.traceIds.set(error, span.spanContext().traceId);
    }
  }

  find(error: unknown): string | undefined {
    const remembered = error && typeof error === "object" ? this.traceIds.get(error) : undefined;
    return remembered ?? otelTrace.getActiveSpan()?.spanContext().traceId;
  }
}

export const trpcFailureTraceIds = new TrpcFailureTraceIds();
