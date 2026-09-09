/**
 * Builds the request body from the package's own `timeseriesInputSchema`
 * (ADR-128), never the browser metric registry.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createAnalyticsLegacyRestApp } from "@langwatch/analytics-server/api-rest/analytics-legacy";
import { createAnalyticsRestApp } from "@langwatch/analytics-server/api-rest/analytics";
import { timeseriesInputSchema } from "@langwatch/analytics-server";
import {
  flexibleDateSchema,
  type AppRestSecurity,
  type MountableRestApp,
} from "@langwatch/api/rest";

/**
 * Canonical and legacy are separate apps, not an alias pair — their refusal
 * bodies differ.
 */
export function mountAnalyticsRest(options: {
  security: AppRestSecurity;
  analytics: () => AnalyticsApi;
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
    }),
    createAnalyticsLegacyRestApp({
      security: options.security,
      analytics: options.analytics,
      requestSchema,
    }),
  ];
}
