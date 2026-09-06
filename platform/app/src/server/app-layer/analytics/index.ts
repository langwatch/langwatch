/**
 * Public surface of the app-layer analytics module (ADR-034 Phase 3).
 *
 * Routes (tRPC + Hono) and other app code reach the shared instance via
 * `getApp().analytics.service` — `createAnalyticsService` here is presets.ts
 * wiring, not a per-call-site factory.
 */

export {
  AnalyticsService,
  type AnalyticsServiceDependencies,
  createAnalyticsService,
} from "./analytics.service";
export { AnalyticsClientUnavailableError } from "./errors";

export { compareForTripwire } from "./tripwire/divergence-compare";
export type {
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "./types";
