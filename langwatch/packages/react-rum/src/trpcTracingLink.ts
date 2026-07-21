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
 * Trace context is *not* injected here. The fetch instrumentation already puts
 * `traceparent` on the batched request, and one header cannot carry a distinct
 * parent for each call inside a batch. So the server's spans hang off the HTTP
 * request rather than off the individual procedure span. Everything stays in
 * one trace — which is the point — but per-procedure client-to-server parentage
 * is approximate under batching. Calls sent unbatched (`skipBatch`) are exact.
 *
 * Fail-open by construction: this sits in the live request path, so any error
 * in the instrumentation passes the operation through untouched rather than
 * failing the user's call.
 *
 * See ADR-058.
 */

import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
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

        const subscription = next(op).subscribe({
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
        });

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
