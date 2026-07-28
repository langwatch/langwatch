export interface LangyAnalyticsEventRecord {
  tenantId: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  aggregateId: string;
  turnId: string | null;
  userId: string | null;
  role: string | null;
  toolName: string | null;
  outcome: string | null;
  model: string | null;
  durationMs: number | null;
  occurredAtMs: number;
  acceptedAtMs: number;
}

/** Analytics-only sink. It is never used for operational Langy reads. */
export interface LangyAnalyticsEventRepository {
  insert(
    record: LangyAnalyticsEventRecord,
    retentionDays: number,
  ): Promise<void>;

  insertBatch(
    records: LangyAnalyticsEventRecord[],
    retentionDays: number,
  ): Promise<void>;
}

export class NullLangyAnalyticsEventRepository
  implements LangyAnalyticsEventRepository
{
  async insert(): Promise<void> {}
  async insertBatch(): Promise<void> {}
}
