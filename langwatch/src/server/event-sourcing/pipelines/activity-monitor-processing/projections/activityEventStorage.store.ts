import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

import { createLogger } from "../../../../../utils/logger";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";

import type { ClickHouseActivityEventRecord } from "./activityEventStorage.mapProjection";

const TABLE_NAME = "gateway_activity_events" as const;

const logger = createLogger(
  "langwatch:activity-monitor-processing:activity-event-append-store",
);

/**
 * Creates an AppendStore for the activityEventStorage map projection.
 * Adapts the ClickHouse insert into gateway_activity_events to the
 * AppendStore interface.
 *
 * No-op (debug log) when no CH client is available — smaller
 * self-hosters running without ClickHouse should still see
 * IngestionSource lifecycle (status flip, lastEventAt) work.
 */
export function createActivityEventAppendStore(
  resolveClient: ClickHouseClientResolver | null,
): AppendStore<ClickHouseActivityEventRecord> {
  return {
    async append(
      record: ClickHouseActivityEventRecord,
      context: ProjectionStoreContext,
    ): Promise<void> {
      if (!resolveClient) {
        logger.debug(
          { eventId: record.EventId, tenantId: context.tenantId },
          "ClickHouse client not available, skipping activity event storage",
        );
        return;
      }
      const client = await resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    },
  };
}
