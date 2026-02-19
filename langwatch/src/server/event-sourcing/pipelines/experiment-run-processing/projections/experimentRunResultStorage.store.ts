import type { ClickHouseClient } from "@clickhouse/client";
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
  clickhouse: ClickHouseClient | null,
): AppendStore<ClickHouseExperimentRunResultRecord> {
  return {
    async append(
      record: ClickHouseExperimentRunResultRecord,
      _context: ProjectionStoreContext,
    ): Promise<void> {
      if (!clickhouse) {
        logger.warn(
          { recordId: record.Id },
          "ClickHouse client not available, skipping experiment run result storage",
        );
        return;
      }

      await clickhouse.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
      });
    },
  };
}
