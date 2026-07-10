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
export interface UnreportedHour {
  sealedHour: Date;
  megabytes: number;
}

export interface StorageUsageHourlyRepository {
  getLastSampledHour(params: { organizationId: string }): Promise<Date | null>;
  recordHours(params: {
    organizationId: string;
    rows: HourlySample[];
  }): Promise<void>;
  /** Oldest-first unreported rows — the reporter's work queue. */
  findUnreportedHours(params: {
    organizationId: string;
    limit: number;
  }): Promise<UnreportedHour[]>;
  /** Stamp the per-hour cursor: this hour is settled (sent or skipped). */
  markReported(params: {
    organizationId: string;
    sealedHour: Date;
    reportedAt: Date;
  }): Promise<void>;
}
