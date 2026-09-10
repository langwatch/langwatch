// The vocabulary is the Ops contract's: one definition of what an anomaly is,
// shared by the rows kept here and by the operator surface that reads them.
import type { Anomaly, AnomalyKind } from "@langwatch/ops-contract";

/** The active anomalies an operator sees, one row per tenant and kind. */
export abstract class AnomalyStateRepository {
  abstract findByKind(tenantId: string, kind: AnomalyKind): Promise<Anomaly | null>;
  abstract upsert(anomaly: Anomaly): Promise<void>;
  abstract clear(tenantId: string, kind: AnomalyKind): Promise<void>;
  abstract list(): Promise<Anomaly[]>;
}

/**
 * The per-tenant ingestion counters the detector reads: a minute series the
 * writers increment, and the cached baseline a tick derives from it.
 */
export abstract class AnomalyRateTrackerRepository {
  abstract listActiveTenants(): Promise<string[]>;
  abstract currentWindowCount(tenantId: string, windowSeconds: number): Promise<number>;
  abstract findCachedBaseline(tenantId: string): Promise<number | null>;
  abstract perMinuteSeries(tenantId: string, lookbackSeconds: number): Promise<number[]>;
  abstract setCachedBaseline(input: {
    tenantId: string;
    baseline: number;
    ttlSeconds?: number | undefined;
  }): Promise<void>;
}
