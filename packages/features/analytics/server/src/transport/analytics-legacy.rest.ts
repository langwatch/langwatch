/**
 * `POST /api/analytics` — the timeseries family's SECOND path, apart from the
 * canonical one because its refusals are not that family's: `{ message }` for a
 * body that is not JSON, `{ error }` for one that parses and fails validation.
 */
import { AnalyticsApi } from "@langwatch/analytics-contract";
import {
  coerceToEpoch,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
} from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import { z } from "zod";

import {
  analyticsTimeseriesRestBodySchema,
  analyticsTimeseriesResponseSchema,
} from "./analytics.rest.ts";

/** The two shapes this door answers a refusal in, as it has always sent them. */
const legacySentenceErrorSchema = z.object({
  message: z.string().optional().describe("Set when the request was rejected before validation"),
  error: z.string().optional().describe("Set when the body parsed and then failed validation"),
});

const LEGACY_DESCRIPTION =
  "Query analytics timeseries with metrics, aggregations and filters. Identical to " +
  "`POST /api/analytics/timeseries`, which is the path to use in new integrations; this one " +
  "stays for callers written against it.";

/**
 * `/api/analytics`, literally. It is a sibling of `/api/analytics/timeseries`
 * rather than a child of it, so it owns no prefix and publishes exactly the one
 * address it answers at, beside the `/api/v1` twin it has always carried.
 */
export const analyticsLegacyRest = defineRestRouter(AnalyticsApi)
  .withNamespace("analytics-legacy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal")

  .post("/api/analytics", "queryAnalyticsTimeseriesLegacy")
  .withRawBody("text", { mediaType: "application/json" })
  .withPermission("analytics:view")
  .responds({ 200: analyticsTimeseriesResponseSchema, 400: legacySentenceErrorSchema })
  .withDocs({
    summary: "Query analytics timeseries (legacy path)",
    description: LEGACY_DESCRIPTION,
    tags: ["Analytics"],
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
  .handle(async ({ app, raw, scope }) => {
    const body = parsedJson(raw);

    if (body === undefined) return { status: 400 as const, body: { message: "Bad request" } };

    const parsed = analyticsTimeseriesRestBodySchema.safeParse(body);

    if (!parsed.success) {
      return { status: 400 as const, body: { error: zodErrorMessage(parsed.error) } };
    }

    return {
      status: 200 as const,
      body: await app.getTimeseries({
        ...parsed.data,
        projectId: scope.id,
        startDate: coerceToEpoch(parsed.data.startDate),
        endDate: coerceToEpoch(parsed.data.endDate),
      }),
    };
  })
  .build();

/** The body as JSON, or `undefined` for a body that is not JSON at all. */
function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
