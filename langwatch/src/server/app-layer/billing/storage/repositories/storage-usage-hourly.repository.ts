export interface HourlySample {
  sealedHour: Date;
  megabytes: number;
}

/**
 * Durable per-sealed-hour samples — the contract every invoice line traces
 * back to. Writes are insert-if-absent: a re-run over already-sampled hours
 * changes nothing (an hour's value is derived deterministically by fold-to-H,
 * so the first write is as correct as any re-write would be).
 */
export interface StorageUsageHourlyRepository {
  getLastSampledHour(params: { organizationId: string }): Promise<Date | null>;
  recordHours(params: {
    organizationId: string;
    rows: HourlySample[];
  }): Promise<void>;
}
