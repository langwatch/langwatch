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
  type RestTransportDeclaration,
} from "@langwatch/api/rest";

/**
 * `/api/analytics/*`, at the dated addresses it has always answered. The type
 * is written out rather than inferred so the declaration emit stays portable.
 */
export const analyticsRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<AnalyticsApi>;
}> = defineRestRouter(AnalyticsApi)
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
