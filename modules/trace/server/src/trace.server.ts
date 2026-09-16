import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { TraceApp } from "./app/trace.app.ts";
import { traceRepositories } from "./repositories/trace-repositories.registry.ts";
import { collectorRest } from "./transport/collector.rest.ts";
import { otlpIngestRest } from "./transport/otlp-ingest.rest.ts";
import { spansTrpcTransport } from "./transport/spans.trpc.ts";
import { traceLegacyRest } from "./transport/trace-legacy.rest.ts";
import {
  trackedEventLegacyPathRest,
  trackedEventRest,
} from "./transport/tracked-event.rest.ts";
import { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
import { tracesRest, tracesRestCredential } from "./transport/traces.rest.ts";
import { tracesTrpcTransport } from "./transport/traces.trpc.ts";

/** The process-owned collaborators needed to construct the Trace application once. */
export type { TraceInfrastructure } from "./app/trace-composition.types.ts";

/**
 * Canonical Trace server feature installer and application factory. The
 * registry selects the Postgres-backed `editOverlay`; TraceApp does not
 * yet take it from `setup.repositories` — see app/trace-read.composition.ts.
 */
export const traceServer = defineServerModule("trace")
  .withRepositories(traceRepositories)
  .withApp(TraceApp)
  .withTransports(
    tracesTrpcTransport,
    spansTrpcTransport,
    traceEditOverlayTrpcTransport,
    traceLegacyRest,
    tracesRest,
    // `POST /api/events/track`, the tracked events an SDK reports against a
    // trace it already sent. A literal, so it is mounted with the other
    // literals and ahead of the OTLP receiver's wildcard.
    trackedEventRest,
    // `POST /api/track_event`, the same thing under the name every pre-rename
    // SDK release still posts to. Hidden from the document, and answering over
    // the canonical route's own body rather than forwarding into it.
    trackedEventLegacyPathRest,
    // `POST /api/collector`, the one address a released SDK posts a trace to.
    // Public and resolves the project credential inside the handler, since
    // its refusal bodies predate the framework envelope. Mounted after the
    // reads — a wildcard in front would swallow this literal.
    collectorRest,
    // `POST /api/otel/v1/{traces,logs,metrics}`, the canonical OTLP receiver,
    // handler-resolved for the same reason the collector is. Mounted LAST
    // of the REST families — the path alias's wildcard must come after it.
    otlpIngestRest,
  )
  .withTransportFacts(() => [
    // The v1 trace reads answer through the key's own grants, so the routes
    // read the CREDENTIAL - its api key id and the member it acts as - rather
    // than whoever holds it. A legacy project key names neither.
    bindRestMiddleware(tracesRestCredential, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      return {
        apiKeyId: credential.type === "apiKey" ? credential.apiKeyId : null,
        userId: credential.type === "apiKey" ? credential.userId : null,
      };
    }),
  ]);
