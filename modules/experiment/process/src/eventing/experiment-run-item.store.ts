import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import type { ExperimentClickHouseRepository } from "../repositories/experiment-clickhouse.repository.ts";
import type { ClickHouseExperimentRunResultRecord } from "./experiment-run-result-storage.projection.ts";

const TABLE_NAME = "experiment_run_items" as const;

const logger = createLogger("langwatch:experiment-run-processing:experiment-run-item-append-store");

/**
 * The AppendStore for experiment run result items.
 */
export class ExperimentRunItemStore implements AppendStore<ClickHouseExperimentRunResultRecord> {
  private constructor(
    private readonly clickhouse: ExperimentClickHouseRepository | null,
    private readonly defaultRetentionDays: () => number,
  ) {}

  static create(options: {
    clickhouse: ExperimentClickHouseRepository | null;
    defaultRetentionDays: () => number;
  }): ExperimentRunItemStore {
    return new ExperimentRunItemStore(options.clickhouse, options.defaultRetentionDays);
  }

  async append(
    record: ClickHouseExperimentRunResultRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.bulkAppend([record], context);
  }

  /** One insert for a queued batch of a run's results, so a backed-up row drains in one write. */
  async bulkAppend(
    records: ClickHouseExperimentRunResultRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    if (!this.clickhouse) {
      logger.warn(
        { recordId: records[0]!.ProjectionId, records: records.length },
        "ClickHouse client not available, skipping experiment run result storage",
      );
      return;
    }

    const retentionDays = context.retentionPolicy?.experiments ?? this.defaultRetentionDays();
    const client = await this.clickhouse.resolveClient(context.tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: records.map((record) => ({ ...record, _retention_days: retentionDays })),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}
