/**
 * This process's composition of the packaged analytics timeseries REST family
 * (`@langwatch/analytics-server`).
 *
 * The route, its OpenAPI declaration and its delegation to {@link AnalyticsApp}
 * live in the feature package (ADR-128). What lives here is the one thing the
 * family cannot own: the body a caller may send.
 *
 * The body is built from the analytics package's OWN `timeseriesInputSchema`
 * rather than from the browser's registry. The registry that enumerated metric
 * names and group-by keys carries colour sets and number formatters, so it
 * stayed in `@langwatch/analytics-web` and no server module may value-import a
 * browser package. The narrowing that used to sit on the wire now sits where
 * the meaning is: the metric translator refuses a key it has no expression
 * for. This is the same judgment the charted tRPC reads already record.
 */
import type { AnalyticsApp } from "@langwatch/analytics-server";
import { createAnalyticsRestApp, timeseriesInputSchema } from "@langwatch/analytics-server";
import { flexibleDateSchema, type AppRestSecurity, type MountableRestApp } from "@langwatch/api/rest";

/**
 * `/api/analytics/timeseries`, bound to one process's analytics application.
 *
 * The period bounds accept an ISO string as well as epoch milliseconds, which
 * is what the published endpoint has always accepted; `projectId` is dropped
 * because this door takes the project from the credential.
 */
export function mountAnalyticsRest(options: {
  security: AppRestSecurity;
  analytics: () => AnalyticsApp;
}): MountableRestApp {
  return createAnalyticsRestApp({
    security: options.security,
    analytics: options.analytics,
    requestSchema: timeseriesInputSchema.omit({ projectId: true }).extend({
      startDate: flexibleDateSchema,
      endDate: flexibleDateSchema,
    }),
  }).hono;
}
