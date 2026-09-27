/**
 * `POST /api/rum/v1/traces`: the browser exports OTLP here, on the app's own
 * origin, rather than to the collector, which stays off the internet (ADR-058).
 * @see modules/rum/specs/browser-telemetry-ingest.feature
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  RUM_MAX_BODY_BYTES,
  RUM_SESSION_HEADER,
  RUM_TRACES_PATH,
} from "@langwatch/react-rum/constants";
import { RumApi, RumPayloadTooLargeError, rumReportHeadersSchema } from "@langwatch/rum-contract";

const ACCEPTED =
  "An OTLP exporter reads only the status: 202 once the report is accepted, whatever the " +
  "collector later makes of it, since a server error would have every open tab retry.";

export const rumRest = defineRestRouter(RumApi)
  .withNamespace("rum")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post(RUM_TRACES_PATH, "ingestBrowserTraces")
  .withRawBody("text")
  .withBodyLimit({
    maxBytes: RUM_MAX_BODY_BYTES,
    onExceeded: () => new RumPayloadTooLargeError(),
  })
  .withAccess(
    publicRoute({
      reason:
        "browser telemetry ingest; the browser has no credential to present and the payload " +
        "is treated as untrusted",
    }),
  )
  .withHeaders(rumReportHeadersSchema)
  .withResponse("protocol", { produces: "application/json", because: ACCEPTED })
  .withDocs({
    tags: ["Browser telemetry"],
    summary: "Report the platform's own browser traces",
    description: `The LangWatch app's browser tracing exports here. ${ACCEPTED}`,
  })
  .handle(async ({ app, raw, response }, headers) => {
    await app.ingestBrowserTraces({
      body: raw,
      session: headers[RUM_SESSION_HEADER],
      forwardedFor: headers["x-forwarded-for"],
    });
    return response.write({ status: 202, mediaType: "application/json", body: null });
  })
  .build();
