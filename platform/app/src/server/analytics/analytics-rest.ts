/**
 * This process's composition of the packaged analytics timeseries REST family
 * (`@langwatch/analytics-server`).
 *
 * The route, its OpenAPI declaration and its delegation to {@link AnalyticsApp}
 * live in the feature package (ADR-128). What lives here is the one thing the
 * family cannot own: the body a caller may send. Its metric names, group-by
 * keys and filter fields come from this application's analytics registry — the
 * catalogue the browser's charts are built from — and the published endpoint
 * accepts exactly that enumeration, so restating a looser schema in the package
 * would widen a public API.
 *
 * The application arrives as a provider rather than an instance, so the OpenAPI
 * generator can build this app with none.
 */
import type { AnalyticsApp } from "@langwatch/analytics-server";
import { createAnalyticsRestApp } from "@langwatch/analytics-server";
import { flexibleDateSchema } from "@langwatch/platform-api/app-rest";
import type { AppRestProjectVariables } from "@langwatch/api/rest";
import type { Hono } from "hono";

import { timeseriesSeriesInput } from "~/server/analytics/registry";
import { sharedFiltersInputSchema } from "~/server/analytics/types";
import { appRestSecurity } from "~/server/api/security";

// Body schema: combine shared filters + timeseries series input, but
// omit projectId (comes from auth) and allow ISO string dates alongside epoch numbers.
const analyticsBodySchema = sharedFiltersInputSchema
  .omit({ projectId: true })
  .extend(timeseriesSeriesInput.shape)
  .extend({
    startDate: flexibleDateSchema,
    endDate: flexibleDateSchema,
  });

/** `/api/analytics`, bound to one process's analytics application. */
export function buildAnalyticsRestApp(
  analytics: () => AnalyticsApp,
): Hono<{ Variables: AppRestProjectVariables }> {
  return createAnalyticsRestApp({
    security: appRestSecurity,
    analytics,
    requestSchema: analyticsBodySchema,
  }).hono;
}
