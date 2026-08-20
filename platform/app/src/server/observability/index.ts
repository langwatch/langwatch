/**
 * Public surface of the observability module — singletons that lazily
 * initialise from the App's Redis connection, so callers in hot paths
 * (GroupQueue producer) reach the connection when they run rather than when
 * they are imported, and don't need to thread Redis through DI.
 */
import { tryGetApp } from "../app-layer/app";
import { TenantRateTracker } from "./tenantRateTracker";

let _tenantRateTracker: TenantRateTracker | null = null;

export function getTenantRateTracker(): TenantRateTracker | null {
  const connection = tryGetApp()?.redis ?? null;
  if (!connection) return null;
  if (!_tenantRateTracker) {
    _tenantRateTracker = new TenantRateTracker(connection);
  }
  return _tenantRateTracker;
}

export {
  AnomalyDetector,
  HARD_TIER_MULTIPLIER,
  HARD_TIER_SUSTAIN_MINUTES,
  SURFACE_TIER_MULTIPLIER,
  SURFACE_TIER_SUSTAIN_MINUTES,
} from "./anomalyDetector";
export {
  type Anomaly,
  type AnomalyKind,
  AnomalyStateStore,
  type AnomalyTier,
} from "./anomalyState";
export { startAnomalyWorker } from "./anomalyWorker";
export { TenantRateTracker, tenantIdFromGroupId } from "./tenantRateTracker";
