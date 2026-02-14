import { getClickHouseClient } from "~/server/clickhouse/client";
import { createLogger } from "../../../../../utils/logger";
import type { AppendStore } from "../../../library/projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type { ClickHouseExperimentRunResultRecord } from "../handlers/experimentRunResultStorage.mapProjection";

const TABLE_NAME = "experiment_run_items" as const;

const logger = createLogger(
  "langwatch:experiment-run-processing:experiment-run-item-append-store",
);

/**
 * AppendStore wrapper for experiment run result items.
 *
 * Adapts the ClickHouse insert into the experiment_run_items table to the
 * AppendStore interface used by MapProjection definitions.
 */
export const experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord> = {
  async append(
    record: ClickHouseExperimentRunResultRecord,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    const clickHouseClient = getClickHouseClient();
    if (!clickHouseClient) {
      logger.warn(
        { recordId: record.Id },
        "ClickHouse client not available, skipping experiment run result storage",
      );
      return;
    }

    await clickHouseClient.insert({
      table: TABLE_NAME,
      values: [record],
      format: "JSONEachRow",
    });
  },
};
