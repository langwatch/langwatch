/**
 * Public surface of the app-layer analytics module (ADR-034 Phase 3).
 *
 * Routes (tRPC + Hono) and other app code import from this barrel:
 *   import { getAnalyticsService } from "~/server/app-layer/analytics";
 */

export {
  AnalyticsService,
  createAnalyticsService,
  getAnalyticsService,
  resetAnalyticsService,
  type AnalyticsServiceDependencies,
} from "./analytics.service";

export {
  isRollupRollableMetricKey,
  isSlimEligibleMetricKey,
  pickAnalyticsTable,
  ROLLUP_ROLLABLE_METRIC_KEYS,
  SLIM_ELIGIBLE_METRIC_KEYS,
  type AnalyticsTable,
  type PickAnalyticsTableInput,
  type RollupRollableMetricKey,
  type SlimEligibleMetricKey,
} from "./routing/route-table";

export { compareForTripwire } from "./tripwire/divergence-compare";

export { AnalyticsClientUnavailableError } from "./errors";
export type {
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "./types";
