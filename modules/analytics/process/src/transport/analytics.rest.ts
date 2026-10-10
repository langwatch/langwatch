/**
 * `POST /api/analytics/timeseries` — the question `analytics.getTimeseries`
 * asks, through the same application. The wire differs: the period bounds take
 * an ISO string as well as epoch milliseconds, and the project is the key's.
 */
import {
  AnalyticsApi,
  analyticsTimeseriesResponseSchema,
  analyticsTimeseriesRestBodySchema,
} from "@langwatch/analytics-contract";
import {
  baseResponses,
  coerceToEpoch,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";

/**
 * `/api/analytics/*`, at the dated addresses it has always answered.
 */
export const analyticsRest = defineRestRouter(AnalyticsApi)
  .withNamespace("analytics")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/timeseries", "postApiAnalyticsTimeseries")
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
