/**
 * @vitest-environment node
 *
 * Proves the tRPC tracer adopts the caller's trace, so work the browser starts
 * and the server work it triggers land in one trace instead of two.
 *
 * Binds the scenarios `A call started in the browser continues on the server`
 * and `Calls over the realtime transports still correlate` in
 * specs/observability/browser-rum-trace-correlation.feature. See ADR-058.
 */
import { propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { beforeAll, describe, expect, it } from "vitest";

import { callerTraceContext } from "../trpc";

const REMOTE_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const REMOTE_SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${REMOTE_TRACE_ID}-${REMOTE_SPAN_ID}-01`;

const spanContextOf = (context: ReturnType<typeof callerTraceContext>) =>
  trace.getSpanContext(context);

describe("callerTraceContext", () => {
  // `propagation.extract` delegates to the globally registered propagator, and
  // the global default is a no-op. Without this the extraction assertions would
  // pass vacuously — every context would come back empty for the wrong reason.
  // The app registers the same W3C propagator in `instrumentation.node.ts`.
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  describe("given a caller that sent trace context", () => {
    describe("when the call arrives over a request-per-call transport", () => {
      /** @scenario A call started in the browser continues on the server */
      it("adopts the caller's trace and span as the parent", () => {
        const context = callerTraceContext({
          req: { headers: { traceparent: TRACEPARENT } },
          type: "query",
        });

        expect(spanContextOf(context)).toMatchObject({
          traceId: REMOTE_TRACE_ID,
          spanId: REMOTE_SPAN_ID,
          isRemote: true,
        });
      });

      it("adopts it for mutations too", () => {
        const context = callerTraceContext({
          req: { headers: { traceparent: TRACEPARENT } },
          type: "mutation",
        });

        expect(spanContextOf(context)?.traceId).toBe(REMOTE_TRACE_ID);
      });
    });

    describe("when the call is a subscription", () => {
      /**
       * A subscription rides a long-lived connection, so `req` is the handshake
       * request. Adopting it would parent every later message to whatever trace
       * happened to open the socket.
       */
      it("ignores the handshake trace rather than reusing it forever", () => {
        const context = callerTraceContext({
          req: { headers: { traceparent: TRACEPARENT } },
          type: "subscription",
        });

        expect(spanContextOf(context)).toBeUndefined();
      });
    });
  });

  describe("given a caller that sent no trace context", () => {
    it("starts a fresh trace when the header is absent", () => {
      const context = callerTraceContext({
        req: { headers: { "user-agent": "vitest" } },
        type: "query",
      });

      expect(spanContextOf(context)).toBeUndefined();
    });

    it("starts a fresh trace when the traceparent is malformed", () => {
      const context = callerTraceContext({
        req: { headers: { traceparent: "not-a-traceparent" } },
        type: "query",
      });

      expect(spanContextOf(context)).toBeUndefined();
    });
  });

  describe("given a call with no request at all", () => {
    /**
     * `createInnerTRPCContext` is used by tests and SSG helpers with no req/res,
     * so this path has to stay non-throwing.
     */
    it("survives a missing req", () => {
      expect(() =>
        callerTraceContext({ req: void 0, type: "query" }),
      ).not.toThrow();
    });

    it("survives a req with no headers", () => {
      expect(spanContextOf(callerTraceContext({ req: {}, type: "query" })))
        .toBeUndefined();
    });
  });
});
