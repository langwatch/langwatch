import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ExperimentEventingClickHouseResolver } from "../ports/experiment-clickhouse.port";
import type { ClickHouseExperimentRunResultRecord } from "../projections/experiment-run-result-storage.projection";

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
  resolveClient: ExperimentEventingClickHouseResolver | null,
  defaultRetentionDays: number,
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

      const retentionDays =
        context.retentionPolicy?.experiments ?? defaultRetentionDays;
      const recordWithRetention = {
        ...record,
        _retention_days: retentionDays,
      };

      const client = await resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [recordWithRetention],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    },
  };
}
