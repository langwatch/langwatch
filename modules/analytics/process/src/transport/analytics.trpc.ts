/**
 * The server half of `analytics.*`. A series takes `analytics:view`, the cost-oriented
 * reads (documents, feedbacks and their pages) `cost:view`; nothing here decides what a
 * series means.
 * @see modules/analytics/specs/analytics-timeseries.feature
 */
import { AnalyticsApi, analyticsTrpc } from "@langwatch/analytics-contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";

export const analyticsTrpcTransport: TrpcRouterDeclaration<AnalyticsApi, typeof analyticsTrpc> =
  defineTrpcRouter(AnalyticsApi, analyticsTrpc)
    .procedure("getTimeseries")
    .withPermission("analytics:view")
    .handle(({ app, input, authorization }) => app.getTimeseries(input, { authorization }))

    .procedure("dataForFilter")
    .withPermission("analytics:view")
    .handle(async ({ app, input, authorization }) => ({
      options: await app.filterOptions(input, { authorization }),
    }))

    .procedure("topUsedDocuments")
    .withPermission("cost:view")
    .handle(({ app, input, authorization }) => app.getTopUsedDocuments(input, { authorization }))

    .procedure("feedbacks")
    .withPermission("cost:view")
    .handle(({ app, input, authorization }) => app.getFeedbacks(input, { authorization }))

    .procedure("feedbacksPage")
    .withPermission("cost:view")
    .handle(({ app, input, authorization }) => app.getFeedbacksPage(input, { authorization }))
    .build();
