import { defineModule } from "@langwatch/runtime-composition";
import { TraceApp } from "./app/trace.app.ts";
import { spansTrpcTransport } from "./transport/spans.trpc.ts";
import { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
import { tracesTrpcTransport } from "./transport/traces.trpc.ts";

/** The process-owned collaborators needed to construct the Trace application once. */
export type { TraceInfrastructure } from "./app/trace-composition.types.ts";

/** Canonical Trace server feature installer and application factory. */
export const traceServer = defineModule("trace")
  .withApp(TraceApp)
  .withTransports(tracesTrpcTransport, spansTrpcTransport, traceEditOverlayTrpcTransport)
  .build();
