import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { z } from "zod";

import {
  ANALYTICS_METADATA_COLUMNS,
  TraceIndexMaterialisationRepository,
  materialisationMutationSchema,
  type MaterialisationMutation,
} from "../trace-index-materialisation.repository.ts";

const mutationRowsSchema = z.array(
  z
    .object({
      mutationId: z.string(),
      isDone: z.number(),
      partsToDo: z.number(),
      latestFailReason: z.string(),
    })
    .transform((row) => materialisationMutationSchema.parse({ ...row, isDone: row.isDone === 1 })),
);

const MATERIALISE_METADATA_COLUMNS = ANALYTICS_METADATA_COLUMNS.map(
  (column) => `MATERIALIZE COLUMN ${column}`,
).join(", ");

/** Reads and starts the trace module's materialisations on the shared ClickHouse target. */
export class ClickHouseTraceIndexMaterialisationRepository extends TraceIndexMaterialisationRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceIndexMaterialisationRepository {
    return new ClickHouseTraceIndexMaterialisationRepository(clickhouse);
  }

  async findUpdatedAtIndexMutations(): Promise<MaterialisationMutation[]> {
    return this.mutationsOf({
      table: "trace_summaries",
      command: "MATERIALIZE INDEX idx_updated_at",
    });
  }

  async findAnalyticsMetadataColumnMutations(): Promise<MaterialisationMutation[]> {
    return this.mutationsOf({
      table: "trace_analytics",
      command: `MATERIALIZE COLUMN ${ANALYTICS_METADATA_COLUMNS[0]}`,
    });
  }

  async materialiseUpdatedAtIndex(): Promise<void> {
    await this.#clickhouse.command({
      tenantId: "",
      table: "trace_summaries",
      kind: "write",
      sql: "ALTER TABLE trace_summaries MATERIALIZE INDEX IF EXISTS idx_updated_at",
      // Materialising a skip index is a whole-table mutation on the shared target, which no tenant
      // owns.
      SKIP_TENANT_CHECK: true,
    });
  }

  async materialiseAnalyticsMetadataColumns(): Promise<void> {
    await this.#clickhouse.command({
      tenantId: "",
      table: "trace_analytics",
      kind: "write",
      sql: `ALTER TABLE trace_analytics ${MATERIALISE_METADATA_COLUMNS}`,
      // Filling a column in every part is a whole-table mutation on the shared target, which no
      // tenant owns.
      SKIP_TENANT_CHECK: true,
    });
  }

  /** The table's mutations whose command holds `command`, newest first. */
  private async mutationsOf({
    table,
    command,
  }: {
    table: string;
    command: string;
  }): Promise<MaterialisationMutation[]> {
    const { rows } = await this.#clickhouse.query<unknown>({
      tenantId: "",
      table: "system.mutations",
      kind: "read",
      sql: `
        SELECT
          mutation_id AS mutationId,
          is_done AS isDone,
          toUInt32(parts_to_do) AS partsToDo,
          latest_fail_reason AS latestFailReason
        FROM system.mutations
        WHERE database = currentDatabase()
          AND table = {table:String}
          AND position(command, {command:String}) > 0
        ORDER BY create_time DESC
      `,
      params: { table, command },
      // A materialisation is a whole-table mutation on the shared target, which no tenant owns.
      SKIP_TENANT_CHECK: true,
    });
    return mutationRowsSchema.parse(rows);
  }
}
