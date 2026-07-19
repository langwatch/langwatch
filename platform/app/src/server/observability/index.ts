/**
 * Public surface of the observability module — singletons that lazily
 * initialise from the global Redis connection so callers in hot paths
 * (GroupQueue producer) don't pay an import cost per invocation and
 * don't need to thread Redis through DI.
 */
import { connection } from "../redis";
import { TenantRateTracker } from "./tenantRateTracker";

let _tenantRateTracker: TenantRateTracker | null = null;

export function getTenantRateTracker(): TenantRateTracker | null {
  if (!connection) return null;
  if (!_tenantRateTracker) {
    _tenantRateTracker = new TenantRateTracker(connection);
  }
  return _tenantRateTracker;
}

export { TenantRateTracker, tenantIdFromGroupId } from "./tenantRateTracker";
export {
  AnomalyDetector,
  SURFACE_TIER_MULTIPLIER,
  HARD_TIER_MULTIPLIER,
  SURFACE_TIER_SUSTAIN_MINUTES,
  HARD_TIER_SUSTAIN_MINUTES,
} from "./anomalyDetector";
export { AnomalyStateStore, type Anomaly, type AnomalyKind, type AnomalyTier } from "./anomalyState";
export { startAnomalyWorker } from "./anomalyWorker";
