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

export { compareForTripwire } from "./tripwire/divergence-compare";
export type {
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "./types";
