/**
 * The server half of `analytics.*`. A series takes `analytics:view`, the two
 * cost-oriented reads `cost:view`; nothing here decides what a series means.
 * @see modules/analytics/specs/analytics-timeseries.feature
 */
import { AnalyticsApi, analyticsTrpc } from "@langwatch/analytics-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";

export const analyticsTrpcTransport = defineTrpcRouter(AnalyticsApi, analyticsTrpc)
  .procedure("getTimeseries")
  .withPermission("analytics:view")
  .handle(({ app, input }) => app.getTimeseries(input))

  .procedure("dataForFilter")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) => ({ options: await app.filterOptions(input) }))

  .procedure("topUsedDocuments")
  .withPermission("cost:view")
  .handle(({ app, input }) => app.getTopUsedDocuments(input))

  .procedure("feedbacks")
  .withPermission("cost:view")
  .handle(({ app, input }) => app.getFeedbacks(input))
  .build();
