/**
 * `POST /api/analytics` — the timeseries family's SECOND path, apart from the
 * canonical one because its refusals are not that family's: `{ message }` for a
 * body that is not JSON, `{ error }` for one that parses and fails validation.
 */
import {
  analyticsTimeseriesResponseSchema,
  analyticsTimeseriesRestBodySchema,
  legacySentenceErrorSchema,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

/** What the legacy door answers: its own sentence refusals, or the series. */
export type AnalyticsLegacyTimeseriesAnswer =
  | Readonly<{ status: 400; body: { readonly message: string } | { readonly error: string } }>
  | Readonly<{ status: 200; body: AnalyticsTimeseriesResult }>;

/** What the legacy door reaches: the raw body, read and refused in the family's own sentences. */
export interface AnalyticsLegacyApi {
  answerLegacyTimeseries(
    input: Readonly<{ raw: string; projectId: string }>,
  ): Promise<AnalyticsLegacyTimeseriesAnswer>;
}

export const AnalyticsLegacyApi = moduleApi<AnalyticsLegacyApi>()("analytics");

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

const LEGACY_DESCRIPTION =
  "Query analytics timeseries with metrics, aggregations and filters. Identical to " +
  "`POST /api/analytics/timeseries`, which is the path to use in new integrations; this one " +
  "stays for callers written against it.";

/**
 * `/api/analytics`, literally. It is a sibling of `/api/analytics/timeseries`
 * rather than a child of it, so it owns no prefix and publishes exactly the one
 * address it answers at, beside the `/api/v1` twin it has always carried.
 */
export const analyticsLegacyRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AnalyticsLegacyApi>;
}> = defineRestRouter(AnalyticsLegacyApi)
  .withNamespace("analytics-legacy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal")

  .post("/api/analytics", "postApiAnalytics")
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withPermission("analytics:view")
  .responds({ 200: analyticsTimeseriesResponseSchema, 400: legacySentenceErrorSchema })
  .withDocs({
    summary: "Query analytics timeseries (legacy path)",
    description: LEGACY_DESCRIPTION,
    tags: ["Analytics"],
    requestBody: { schema: analyticsTimeseriesRestBodySchema },
    responses: {
      400: {
        description: "The body was not valid JSON, or failed validation",
        content: { "application/json": { schema: resolver(legacySentenceErrorSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: resolver(z.object({ message: z.string() })) } },
      },
    },
  })
  .handle(({ app, raw, scope }) => app.answerLegacyTimeseries({ raw, projectId: scope.id }))
  .build();
