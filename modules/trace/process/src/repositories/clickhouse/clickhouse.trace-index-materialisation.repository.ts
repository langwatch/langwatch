import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { z } from "zod";

import {
  TraceIndexMaterialisationRepository,
  updatedAtIndexMutationSchema,
  type UpdatedAtIndexMutation,
} from "../trace-index-materialisation.repository.ts";

const mutationRowsSchema = z.array(
  z
    .object({
      mutationId: z.string(),
      isDone: z.number(),
      partsToDo: z.number(),
      latestFailReason: z.string(),
    })
    .transform((row) => updatedAtIndexMutationSchema.parse({ ...row, isDone: row.isDone === 1 })),
);

/** Reads and starts the `idx_updated_at` mutation on the shared ClickHouse target. */
export class ClickHouseTraceIndexMaterialisationRepository extends TraceIndexMaterialisationRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceIndexMaterialisationRepository {
    return new ClickHouseTraceIndexMaterialisationRepository(clickhouse);
  }

  async findUpdatedAtIndexMutations(): Promise<UpdatedAtIndexMutation[]> {
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
          AND table = 'trace_summaries'
          AND position(command, 'MATERIALIZE INDEX idx_updated_at') > 0
        ORDER BY create_time DESC
      `,
      // Materialising a skip index is a whole-table mutation on the shared target, which no tenant
      // owns.
      SKIP_TENANT_CHECK: true,
    });
    return mutationRowsSchema.parse(rows);
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
}
