import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { STORAGE_METER_READ_SETTINGS } from "@langwatch/data-retention-contract/retention-tables";
import { EventLogRetention } from "@langwatch/eventing/server";

import { EVENT_LOG_RETENTION_CLASSIFICATION } from "../../rules/event-log-retention.rules.ts";
import type { StorageMeterRepository } from "../storage-meter.repository.ts";

/** The event log's bytes through eventing's own built read, under the meter's caps. */
export class ClickHouseStorageMeterRepository implements StorageMeterRepository {
  static create(options: { clickhouse: ClickHouseQueryClient }): ClickHouseStorageMeterRepository {
    return new ClickHouseStorageMeterRepository(
      EventLogRetention.create({
        client: options.clickhouse,
        classification: EVENT_LOG_RETENTION_CLASSIFICATION,
      }),
    );
  }

  private constructor(private readonly eventLog: EventLogRetention) {}

  getEventLogBytes({
    tenantId,
    beforeMs,
  }: {
    tenantId: string;
    beforeMs?: number | undefined;
  }): Promise<number> {
    return this.eventLog.getStoredBytes({
      tenantId,
      settings: STORAGE_METER_READ_SETTINGS,
      beforeMs,
    });
  }
}
