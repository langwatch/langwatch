/**
 * `POST /api/analytics/timeseries` — the question `analytics.getTimeseries`
 * asks, through the same application. The wire differs: the period bounds take
 * an ISO string as well as epoch milliseconds, and the project is the key's.
 */
import { AnalyticsApi, timeseriesInputSchema } from "@langwatch/analytics-contract";
import {
  baseResponses,
  coerceToEpoch,
  defineRestRouter,
  flexibleDateSchema,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { z } from "zod";

/**
 * The timeseries request as this door accepts it: everything the application
 * reads except the project, in either accepted spelling of the bounds.
 */
export const analyticsTimeseriesRestBodySchema = z.object({
  ...timeseriesInputSchema.omit({ projectId: true }).shape,
  startDate: flexibleDateSchema,
  endDate: flexibleDateSchema,
});

/**
 * The wire answer: two arrays of buckets, each an open record. Looser than the
 * contract's result schema, which this door never enforced outbound.
 */
export const analyticsTimeseriesResponseSchema = z.object({
  currentPeriod: z.array(z.record(z.string(), z.any())),
  previousPeriod: z.array(z.record(z.string(), z.any())),
});

/** `/api/analytics/*`, at the dated addresses it has always answered. */
export const analyticsRest = defineRestRouter(AnalyticsApi)
  .withNamespace("analytics")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/timeseries", "queryAnalyticsTimeseries")
  .withInput(analyticsTimeseriesRestBodySchema)
  .withPermission("analytics:view")
  .withOutput(analyticsTimeseriesResponseSchema)
  .withDocs({
    tags: ["Analytics"],
    description: "Query analytics timeseries data with metrics, aggregations, and filters",
    responses: baseResponses,
  })
  .handle(async ({ app, input, scope }) =>
    app.getTimeseries({
      ...input,
      projectId: scope.id,
      startDate: coerceToEpoch(input.startDate),
      endDate: coerceToEpoch(input.endDate),
    }),
  )
  .build();
