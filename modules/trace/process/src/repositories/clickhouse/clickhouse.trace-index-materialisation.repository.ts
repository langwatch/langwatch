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

const partCountSchema = z.array(z.object({ parts: z.number().int().nonnegative() }));

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
      matching: "position(command, {index:String}) > 0",
      params: { index: "MATERIALIZE INDEX idx_updated_at" },
    });
  }

  async findAnalyticsMetadataColumnMutations(): Promise<MaterialisationMutation[]> {
    // Whole column names, all nine: a substring would also match a longer name or a lone column.
    return this.mutationsOf({
      table: "trace_analytics",
      matching:
        "hasAll(extractAll(command, 'MATERIALIZE COLUMN ([A-Za-z0-9_]+)'), {columns:Array(String)})",
      params: { columns: [...ANALYTICS_METADATA_COLUMNS] },
    });
  }

  async countPartsMissingAnalyticsMetadataColumns(): Promise<number> {
    const { rows } = await this.#clickhouse.query<unknown>({
      tenantId: "",
      table: "system.parts_columns",
      kind: "read",
      sql: `
        SELECT toUInt32(count()) AS parts
        FROM (
          SELECT name
          FROM system.parts_columns
          WHERE database = currentDatabase()
            AND table = 'trace_analytics'
            AND active
          GROUP BY name
          HAVING countIf(has({columns:Array(String)}, column)) < length({columns:Array(String)})
        )
      `,
      params: { columns: [...ANALYTICS_METADATA_COLUMNS] },
      // A part's stored columns belong to the shared table, which no tenant owns.
      SKIP_TENANT_CHECK: true,
    });
    return partCountSchema.parse(rows)[0]?.parts ?? 0;
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

  /** The table's mutations whose `command` meets the `matching` condition, newest first. */
  private async mutationsOf({
    table,
    matching,
    params,
  }: {
    table: string;
    matching: string;
    params: Record<string, unknown>;
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
          AND ${matching}
        ORDER BY create_time DESC
      `,
      params: { ...params, table },
      // A materialisation is a whole-table mutation on the shared target, which no tenant owns.
      SKIP_TENANT_CHECK: true,
    });
    return mutationRowsSchema.parse(rows);
  }
}
