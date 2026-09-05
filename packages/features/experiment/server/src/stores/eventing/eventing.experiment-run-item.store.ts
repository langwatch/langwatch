import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ExperimentClickHousePort } from "../../ports/experiment-clickhouse.port";
import type { ClickHouseExperimentRunResultRecord } from "../../projections/experiment-run-result-storage.projection";

const TABLE_NAME = "experiment_run_items" as const;

const logger = createLogger("langwatch:experiment-run-processing:experiment-run-item-append-store");

/**
 * The AppendStore for experiment run result items.
 *
 * Adapts the ClickHouse insert into the experiment_run_items table to the
 * AppendStore interface used by MapProjection definitions.
 */
export class ExperimentRunItemStore implements AppendStore<ClickHouseExperimentRunResultRecord> {
  private constructor(
    private readonly clickhouse: ExperimentClickHousePort | null,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(options: {
    clickhouse: ExperimentClickHousePort | null;
    defaultRetentionDays: number;
  }): ExperimentRunItemStore {
    return new ExperimentRunItemStore(options.clickhouse, options.defaultRetentionDays);
  }

  async append(
    record: ClickHouseExperimentRunResultRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!this.clickhouse) {
      logger.warn(
        { recordId: record.ProjectionId },
        "ClickHouse client not available, skipping experiment run result storage",
      );
      return;
    }

    const retentionDays = context.retentionPolicy?.experiments ?? this.defaultRetentionDays;
    const recordWithRetention = {
      ...record,
      _retention_days: retentionDays,
    };

    const client = await this.clickhouse.resolveClient(context.tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: [recordWithRetention],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}
