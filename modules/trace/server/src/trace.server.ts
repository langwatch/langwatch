import { defineServerModule } from "@langwatch/runtime-composition";
import { TraceApp } from "./app/trace.app.ts";
import { traceRepositories } from "./repositories/trace-repositories.registry.ts";
import { spansTrpcTransport } from "./transport/spans.trpc.ts";
import { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
import { tracesTrpcTransport } from "./transport/traces.trpc.ts";

/** The process-owned collaborators needed to construct the Trace application once. */
export type { TraceInfrastructure } from "./app/trace-composition.types.ts";

/**
 * Canonical Trace server feature installer and application factory.
 * The registry selects the Postgres-backed reviewer correction (`editOverlay`);
 * TraceApp does not yet take it from `setup.repositories` - see
 * app/trace-read.composition.ts, which still constructs its own Prisma
 * repository directly, for the remaining wiring.
 */
export const traceServer = defineServerModule("trace")
  .withRepositories(traceRepositories)
  .withApp(TraceApp)
  .withTransports(tracesTrpcTransport, spansTrpcTransport, traceEditOverlayTrpcTransport)
  .build();
