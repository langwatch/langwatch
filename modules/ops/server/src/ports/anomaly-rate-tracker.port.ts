export abstract class AnomalyRateTrackerPort {
  abstract listActiveTenants(): Promise<string[]>;
  abstract currentWindowCount(tenantId: string, windowSeconds: number): Promise<number>;
  abstract tryGetCachedBaseline(tenantId: string): Promise<number | null>;
  abstract perMinuteSeries(tenantId: string, lookbackSeconds: number): Promise<number[]>;
  abstract setCachedBaseline(input: {
    tenantId: string;
    baseline: number;
    ttlSeconds?: number | undefined;
  }): Promise<void>;
}
