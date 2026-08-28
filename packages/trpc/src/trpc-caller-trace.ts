import { isSpanContextValid, context as otelContext, trace as otelTrace, propagation } from "@opentelemetry/api";

/**
 * The trace context the caller sent with this call, so a tRPC span continues
 * the trace the browser started rather than rooting a fresh one. Without this
 * the UI and the server work it triggers are two unrelated traces, which is the
 * common case because most of the product talks tRPC rather than REST.
 *
 * A local span already on the context wins. When tRPC is served through the
 * HTTP router, its `tracerMiddleware` has already extracted the same
 * `traceparent` and opened the `POST /api` server span that is executing this
 * call — re-extracting would parent the procedure to the *remote* browser span
 * instead, leaving the HTTP span a childless sibling and losing the fact that
 * one contains the other. Extraction is therefore only for callers that arrive
 * with no local span at all.
 *
 * Only the request-per-call transports are consulted. The WebSocket and SSE
 * links hold one long-lived connection, so `ctx.req` there is the *handshake*
 * request — extracting from it would parent every later call on that socket to
 * whatever trace happened to open it. Browsers cannot set headers on a
 * WebSocket handshake, so there is normally nothing to extract, but the rule is
 * stated rather than relied upon.
 *
 * See ADR-058.
 */
export function callerTraceContext({
  req,
  type,
}: {
  // Only the headers are read, and callers range from the Node request to the
  // WS handshake to nothing at all (SSG helpers), so this asks for the one
  // thing it uses rather than for a request type it would have to lie about.
  req: { headers?: Record<string, string | string[] | undefined> } | undefined;
  type: string;
}) {
  const active = otelContext.active();
  if (type === "subscription") return active;

  const localSpan = otelTrace.getSpan(active)?.spanContext();
  if (localSpan && isSpanContextValid(localSpan)) return active;

  const headers = req?.headers;
  if (!headers) return active;

  return propagation.extract(active, headers);
}
