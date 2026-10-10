/**
 * The OTLP logs receiver: `POST /api/otel/v1/logs` and the misconfigured exporter bases main
 * serves it under (otel-path-aliases.ts), behind the `otlp_ingest` door, which resolves the key
 * through Trace before the body is read. Answers, refusals included, are in OTLP's wire.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  OtlpIngestIdentity,
  type RestDoor,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import { LogApi, otlpLogAliasParamsSchema } from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import {
  ingestDoorRefusalBody,
  ingestDoorRefusalStatus,
  isIngestDoorRefusal,
  OTLP_REFUSED_MEDIA_TYPES,
  type OtlpDoorAnswer,
} from "@langwatch/otlp";
import { resolveRequestBound } from "@langwatch/plans";
import {
  otlpIngestCredentialSchema,
  type OtlpIngestCredential,
  type TraceApi,
} from "@langwatch/trace-contract";

import { otlpLogAnswer } from "../rules/otlp-log-answer.rules.ts";

const logger = createLogger("langwatch:otel:v1:logs");

const PRODUCES_JSON = "application/json";

const OTLP_PROTOCOL_REASON =
  "OTLP/HTTP answers exporters in the protocol's own statuses and bodies, credential refusals included";

const INGEST_ACCESS = anyAuthenticated({
  reason: "the OTLP ingest door's resolved key is the whole gate, as on main",
});

/** The only headers the receiver reads; the credential stays at the door. */
const BODY_HEADERS: ReadonlySet<string> = new Set(["content-type", "content-encoding"]);

/** Wire-body cap; the decompressed cap is separate. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

/** The `otlp_ingest` door over Trace's key directory; a refusal is logged with its fingerprint. */
export function otlpLogsDoor(credential: TraceApi["otlpCredential"]): RestDoor {
  return OtlpIngestIdentity.create({
    verify: async ({ diagnostics, ...presented }) => {
      try {
        const resolution = await credential(presented);
        const { apiKeyId } = resolution.identity;
        const actor = apiKeyId ? { type: "api_key" as const, id: apiKeyId } : null;

        return { actor, projectId: resolution.project.id, session: resolution };
      } catch (error) {
        if (!isIngestDoorRefusal(error)) throw error;

        logger.warn(
          { ...diagnostics, refusalStatus: ingestDoorRefusalStatus(error) },
          diagnostics.hasEmptyAuthToken
            ? "Authentication failed: X-Auth-Token sent but empty"
            : "Authentication failed",
        );
        throw error;
      }
    },
  });
}

/** The door's credential refusals in main's body; anything else goes to the family boundary. */
const otlpIngestRefusal: RestProtocolRefusal = ({ failure, response }) =>
  isIngestDoorRefusal(failure)
    ? response.write({
        status: ingestDoorRefusalStatus(failure),
        mediaType: PRODUCES_JSON,
        body: JSON.stringify(ingestDoorRefusalBody(failure)),
      })
    : response.decline();

async function receive({
  app,
  raw,
  request,
  credential,
}: {
  app: LogApi;
  raw: Uint8Array;
  request: Request;
  credential: OtlpIngestCredential;
}): Promise<
  Readonly<{ status: OtlpDoorAnswer["status"]; mediaType: typeof PRODUCES_JSON; body: string }>
> {
  const { status, body } = otlpLogAnswer(
    await app.receiveOtlpLogs({
      request: {
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(
          [...request.headers].filter(([name]) => BODY_HEADERS.has(name)),
        ),
        body: raw,
      },
      credential,
    }),
  );
  return { status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) };
}

export const otlpLogsRest = defineRestRouter(LogApi)
  .withNamespace("otel-logs")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("otlp_ingest")

  .post("/api/otel/v1/logs", "ingestOtlpLogs")
  .withCredential("otlp_ingest", { session: otlpIngestCredentialSchema })
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_ACCESS)
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: OTLP_PROTOCOL_REASON,
    refusal: otlpIngestRefusal,
  })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response, session }) =>
    response.write(await receive({ app, raw, request, credential: session })),
  )

  // Exporters append `/v1/logs` to their configured base; the receiver serves
  // only the bases `canonicalOtlpPath` allows, and answers 404 to the rest.
  .post("/:otlpBase{.+}/v1/logs", "ingestOtlpLogsAlias")
  .withParams(otlpLogAliasParamsSchema)
  .withCredential("otlp_ingest", { session: otlpIngestCredentialSchema })
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_ACCESS)
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: OTLP_PROTOCOL_REASON,
    refusal: otlpIngestRefusal,
  })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response, session }) =>
    response.write(await receive({ app, raw, request, credential: session })),
  )

  .post("/:otlpBase{.+}/v1/logs/", "ingestOtlpLogsAliasSlash")
  .withParams(otlpLogAliasParamsSchema)
  .withCredential("otlp_ingest", { session: otlpIngestCredentialSchema })
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_ACCESS)
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: OTLP_PROTOCOL_REASON,
    refusal: otlpIngestRefusal,
  })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response, session }) =>
    response.write(await receive({ app, raw, request, credential: session })),
  )

  .post("/v1/logs", "ingestOtlpLogsRootV1")
  .withCredential("otlp_ingest", { session: otlpIngestCredentialSchema })
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_ACCESS)
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: OTLP_PROTOCOL_REASON,
    refusal: otlpIngestRefusal,
  })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response, session }) =>
    response.write(await receive({ app, raw, request, credential: session })),
  )

  .post("/v1/logs/", "ingestOtlpLogsRootV1Slash")
  .withCredential("otlp_ingest", { session: otlpIngestCredentialSchema })
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_ACCESS)
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: OTLP_PROTOCOL_REASON,
    refusal: otlpIngestRefusal,
  })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response, session }) =>
    response.write(await receive({ app, raw, request, credential: session })),
  )

  .build();
