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
import {
  createAnalyticsLegacyRestApp,
  createAnalyticsRestApp,
  timeseriesInputSchema,
} from "@langwatch/analytics-server";
import {
  flexibleDateSchema,
  type AppRestSecurity,
  type MountableRestApp,
} from "@langwatch/api/rest";

/**
 * The charted reads' TWO public paths, bound to one process's analytics
 * application.
 *
 * `/api/analytics/timeseries` is the canonical one and `/api/analytics` is the
 * legacy path callers were written against. Both are mounted together because
 * they answer the same question off the same application; they are two apps
 * rather than an alias because their REFUSALS differ — the legacy one sends a
 * bare `{ message }` or `{ error }` sentence where the canonical one sends the
 * framework's envelope — and registering one as an alias of the other would
 * change a wire two doors currently answer differently.
 *
 * The period bounds accept an ISO string as well as epoch milliseconds, which
 * is what both published endpoints have always accepted; `projectId` is dropped
 * because both take the project from the credential.
 *
 * ORDERING between the two is free: `/api/analytics` is a literal path and
 * `/api/analytics/timeseries` is a deeper literal path, so neither shadows the
 * other whichever is registered first.
 */
export function mountAnalyticsRest(options: {
  security: AppRestSecurity;
  analytics: () => AnalyticsApp;
}): MountableRestApp[] {
  const requestSchema = timeseriesInputSchema.omit({ projectId: true }).extend({
    startDate: flexibleDateSchema,
    endDate: flexibleDateSchema,
  });
  return [
    createAnalyticsRestApp({
      security: options.security,
      analytics: options.analytics,
      requestSchema,
    }).hono,
    createAnalyticsLegacyRestApp({
      security: options.security,
      analytics: options.analytics,
      requestSchema,
    }).hono,
  ];
}
