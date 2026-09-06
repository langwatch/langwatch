/**
 * Builds the request body from the package's own `timeseriesInputSchema`
 * (ADR-128), never the browser metric registry.
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
 * Canonical and legacy are separate apps, not an alias pair — their refusal
 * bodies differ.
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
    }),
    createAnalyticsLegacyRestApp({
      security: options.security,
      analytics: options.analytics,
      requestSchema,
    }),
  ];
}
