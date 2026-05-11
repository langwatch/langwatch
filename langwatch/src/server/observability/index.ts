/**
 * Public surface of the observability module — singletons that lazily
 * initialise from the global Redis connection so callers in hot paths
 * (recordSpan command, GroupQueue producer) don't pay an import cost
 * per invocation and don't need to thread Redis through DI.
 */
import { connection } from "../redis";
import { FingerprintTracker } from "./fingerprintTracker";
import { TenantRateTracker } from "./tenantRateTracker";

let _fingerprintTracker: FingerprintTracker | null = null;
let _tenantRateTracker: TenantRateTracker | null = null;

export function getFingerprintTracker(): FingerprintTracker | null {
  if (!connection) return null;
  if (!_fingerprintTracker) {
    _fingerprintTracker = new FingerprintTracker(connection);
  }
  return _fingerprintTracker;
}

export function getTenantRateTracker(): TenantRateTracker | null {
  if (!connection) return null;
  if (!_tenantRateTracker) {
    _tenantRateTracker = new TenantRateTracker(connection);
  }
  return _tenantRateTracker;
}

export {
  computeStructuralFingerprint,
  type StructuralFingerprint,
  type FingerprintInputSpan,
} from "./structuralFingerprint";
export { FingerprintTracker } from "./fingerprintTracker";
export { TenantRateTracker, tenantIdFromGroupId } from "./tenantRateTracker";
export {
  AnomalyDetector,
  SURFACE_TIER_MULTIPLIER,
  HARD_TIER_MULTIPLIER,
  SURFACE_TIER_SUSTAIN_MINUTES,
  HARD_TIER_SUSTAIN_MINUTES,
  FINGERPRINT_CONCENTRATION_THRESHOLD,
  FINGERPRINT_MIN_RATE_PER_MIN,
  FINGERPRINT_WINDOW_MINUTES,
} from "./anomalyDetector";
export { AnomalyStateStore, type Anomaly, type AnomalyKind, type AnomalyTier } from "./anomalyState";
export { startAnomalyWorker } from "./anomalyWorker";
