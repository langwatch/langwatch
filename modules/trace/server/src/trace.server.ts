import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { TraceApp } from "./app/trace.app.ts";
import { traceRepositories } from "./repositories/trace-repositories.registry.ts";
import { collectorRest } from "./transport/collector.rest.ts";
import { spansTrpcTransport } from "./transport/spans.trpc.ts";
import { traceLegacyRest } from "./transport/trace-legacy.rest.ts";
import { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
import { tracesRest, tracesRestCredential } from "./transport/traces.rest.ts";
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
  .withTransports(
    tracesTrpcTransport,
    spansTrpcTransport,
    traceEditOverlayTrpcTransport,
    traceLegacyRest,
    tracesRest,
    // `POST /api/collector`, the one address a released SDK posts a trace to.
    // It binds NO transport fact, unlike the reads above: the door is declared
    // public and resolves the project credential inside the handler, because
    // its refusal bodies predate the framework envelope and a deployed SDK
    // parses them. The binding it does have is `TraceApp.collectorCredential`,
    // which every mounted process supplies through the API-key directory.
    //
    // Mounted last of the REST families, and anything matching `/api/collector/*`
    // must be mounted after it: a wildcard in front would swallow this literal.
    collectorRest,
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
