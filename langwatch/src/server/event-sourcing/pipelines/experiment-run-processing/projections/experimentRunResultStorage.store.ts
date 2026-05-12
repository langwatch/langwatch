import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "../../../../../utils/logger";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { ClickHouseExperimentRunResultRecord } from "./experimentRunResultStorage.mapProjection";

const TABLE_NAME = "experiment_run_items" as const;

const logger = createLogger(
  "langwatch:experiment-run-processing:experiment-run-item-append-store",
);

/**
 * Creates an AppendStore for experiment run result items.
 *
 * Adapts the ClickHouse insert into the experiment_run_items table to the
 * AppendStore interface used by MapProjection definitions.
 */
export function createExperimentRunItemAppendStore(
  resolveClient: ClickHouseClientResolver | null,
): AppendStore<ClickHouseExperimentRunResultRecord> {
  return {
    async append(
      record: ClickHouseExperimentRunResultRecord,
      context: ProjectionStoreContext,
    ): Promise<void> {
      if (!resolveClient) {
        logger.warn(
          { recordId: record.ProjectionId },
          "ClickHouse client not available, skipping experiment run result storage",
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
