import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "../../../../../utils/logger";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { EventUtils } from "../../../";
import type { ClickHouseLangyMessageRecord } from "./langyMessageStorage.mapProjection";

const TABLE_NAME = "langy_messages" as const;

const logger = createLogger(
  "langwatch:langy-conversation-processing:message-append-store",
);

/**
 * AppendStore for Langy message rows. Adapts a ClickHouse insert into the
 * existing `langy_messages` table to the AppendStore interface used by the map
 * projection. `ReplacingMergeTree(UpdatedAt)` on
 * (TenantId, ConversationId, MessageId) makes a retried append idempotent.
 */
export function createLangyMessageAppendStore(
  resolveClient: ClickHouseClientResolver | null,
): AppendStore<ClickHouseLangyMessageRecord> {
  return {
    async append(
      record: ClickHouseLangyMessageRecord,
      context: ProjectionStoreContext,
    ): Promise<void> {
      EventUtils.validateTenantId(context, "LangyMessageAppendStore.append");

      if (record.TenantId !== context.tenantId) {
        throw new Error(
          `Langy message record TenantId '${record.TenantId}' does not match context tenantId '${context.tenantId}'`,
        );
      }

      if (!resolveClient) {
        logger.warn(
          { conversationId: record.ConversationId, messageId: record.MessageId },
          "ClickHouse client not available, skipping langy message storage",
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
