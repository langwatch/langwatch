import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { TraceApp } from "./app/trace.app.ts";
import { ClickHouseTraceEventPayloadRepository } from "./repositories/clickhouse/trace-event-payload.repository.ts";
import {
  TraceLegacyReadClickHouseRepository,
  type ClickHouseTraceLegacyReadOptions,
} from "./repositories/clickhouse/trace-legacy-read.repository.ts";
import type { TraceClickHouseResolver } from "./repositories/trace-clickhouse-client.repository.ts";
import type { TraceLegacyReadRepository } from "./repositories/trace-legacy-read.repository.ts";
import type { TracePayloadReaderRepository } from "./repositories/trace-payload-reader.repository.ts";
import { traceRepositories } from "./repositories/trace-repositories.registry.ts";
import { collectorRest } from "./transport/collector.rest.ts";
import { otlpIngestRest } from "./transport/otlp-ingest.rest.ts";
import { sharedTraceTrpcTransport } from "./transport/shared-trace.trpc.ts";
import { spansTrpcTransport } from "./transport/spans.trpc.ts";
import { traceEditOverlayTrpcTransport } from "./transport/trace-edit-overlay.trpc.ts";
import { traceExportRest } from "./transport/trace-export.rest.ts";
import { traceLegacyRest } from "./transport/trace-legacy.rest.ts";
import { tracesRest, tracesRestCredential } from "./transport/traces.rest.ts";
import { tracesTrpcTransport } from "./transport/traces.trpc.ts";
import { trackedEventLegacyPathRest, trackedEventRest } from "./transport/tracked-event.rest.ts";

/** The process-owned collaborators needed to construct the Trace application once. */
export type { TraceInfrastructure } from "./app/trace-composition.types.ts";

/**
 * The durable ADR-022 claim-check reader alone, over a composition root's own tenant-keyed
 * ClickHouse resolver — a composing worker calls this instead of naming the repository class
 * (private-runtime-export drive, dev/docs/plans/private-runtime-export-drive.md §3d).
 */
export function createTracePayloadReader(options: {
  resolveClickHouseClient: TraceClickHouseResolver;
}): TracePayloadReaderRepository {
  return ClickHouseTraceEventPayloadRepository.createResolved({
    resolveClient: options.resolveClickHouseClient,
  });
}

/**
 * The full legacy trace read alone, over ClickHouse — a composing worker calls this instead of
 * naming the repository class (private-runtime-export drive, §3d).
 */
export function createTraceLegacyRead(
  options: ClickHouseTraceLegacyReadOptions,
): TraceLegacyReadRepository {
  return TraceLegacyReadClickHouseRepository.create(options);
}

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
    sharedTraceTrpcTransport,
    spansTrpcTransport,
    traceEditOverlayTrpcTransport,
    traceExportRest,
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
