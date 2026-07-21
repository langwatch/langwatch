/**
 * A tRPC link that opens a span per *procedure call*.
 *
 * Fetch instrumentation alone cannot answer the question people actually ask.
 * `httpBatchLink` collapses several calls into one HTTP request, so a single
 * `POST /api/trpc` span says a batch was slow without saying which call in it
 * was — and the WebSocket and SSE transports produce no fetch span at all.
 * This link sits above the transport split, so every call is visible whichever
 * way it travelled.
 *
 * The span is made *active* for the duration of the call, which is what keeps
 * everything in one trace: the fetch instrumentation picks the active span up
 * as its parent, so the HTTP span — and through `traceparent`, every server
 * span under it — descends from the procedure span rather than starting a trace
 * of its own.
 *
 * Trace context is not injected here directly. Fetch instrumentation writes the
 * header, and one header cannot carry a distinct parent for each call inside a
 * batch, so under `httpBatchLink` the server's spans hang off whichever call in
 * the batch opened the request. Per-procedure parentage is therefore exact for
 * unbatched calls (`skipBatch`) and approximate within a batch.
 *
 * Fail-open by construction: this sits in the live request path, so any error
 * in the instrumentation passes the operation through untouched rather than
 * failing the user's call.
 *
 * See ADR-058.
 */

import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";

const TRACER_NAME = "langwatch:trpc:client";

export function tracingLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
  return () =>
    ({ next, op }) =>
      observable((observer) => {
        const span = startSpan(op);
        if (!span) return next(op).subscribe(observer);

        // Active for the subscribe call, so the transport's own instrumentation
        // (fetch, and anything else that reads the active context) parents onto
        // this span instead of rooting a separate trace.
        const subscription = otelContext.with(
          trace.setSpan(otelContext.active(), span),
          () =>
            next(op).subscribe({
              next(value) {
                observer.next(value);
              },
              error(error) {
                try {
                  span.recordException(error as unknown as Error);
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error?.message,
                  });
                  span.end();
                } catch {
                  // An error reporting an error is not worth propagating.
                }
                observer.error(error);
              },
              complete() {
                try {
                  span.end();
                } catch {
                  // See above.
                }
                observer.complete();
              },
            }),
        );

        return () => {
          // Unsubscribing before completion — a cancelled query, an unmounted
          // component — still has to end the span, or it is never exported and
          // the batch it belongs to looks truncated.
          try {
            if (span.isRecording()) span.end();
          } catch {
            // See above.
          }
          subscription.unsubscribe();
        };
      });
}

function startSpan(op: { path: string; type: string }) {
  try {
    return trace.getTracer(TRACER_NAME).startSpan(`trpc.${op.path}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        "rpc.system": "trpc",
        "rpc.method": op.path,
        "rpc.type": op.type,
      },
    });
  } catch {
    return void 0;
  }
}
