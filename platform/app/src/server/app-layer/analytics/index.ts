/**
 * Public surface of the app-layer analytics module (ADR-034 Phase 3).
 *
 * Routes (tRPC + Hono) and other app code import from this barrel:
 *   import { getAnalyticsService } from "~/server/app-layer/analytics";
 */

export {
  AnalyticsService,
  type AnalyticsServiceDependencies,
  createAnalyticsService,
  getAnalyticsService,
  resetAnalyticsService,
} from "./analytics.service";
export { AnalyticsClientUnavailableError } from "./errors";

export {
  FIELD_AVAILABILITY,
  type FieldAvailability,
  getFieldAvailability,
} from "./routing/field-availability";
export {
  type AnalyticsTable,
  isRollupRollableMetricKey,
  isSlimEligibleMetricKey,
  type PickAnalyticsTableInput,
  pickAnalyticsTable,
  ROLLUP_ROLLABLE_METRIC_KEYS,
  type RollupRollableMetricKey,
  SLIM_ELIGIBLE_METRIC_KEYS,
  type SlimEligibleMetricKey,
} from "./routing/route-table";
export { compareForTripwire } from "./tripwire/divergence-compare";
export type {
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "./types";
