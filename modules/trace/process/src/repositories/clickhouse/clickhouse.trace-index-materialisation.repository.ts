import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  cond,
  type Condition,
  fn,
  param,
  systemMutations,
  systemPartsColumns,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
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

/** A table's mutations whose `command` meets `matching`, newest first, on the system identity. */
function mutationsStatement({
  table,
  matching,
}: {
  table: string;
  matching: Condition<"system.mutations">;
}) {
  return clickhouseRead({
    scope: tenantScope.allTenants({
      reason:
        "a materialisation is a whole-table mutation on the shared target, which no tenant owns",
    }),
  })
    .from(systemMutations)
    .select({
      mutationId: systemMutations.mutation_id,
      isDone: systemMutations.is_done,
      partsToDo: fn.toUInt32(systemMutations.parts_to_do),
      latestFailReason: systemMutations.latest_fail_reason,
    })
    .where(({ and, eq }) =>
      and(
        eq(systemMutations.database, fn.currentDatabase()),
        eq(systemMutations.table, table),
        matching,
      ),
    )
    .orderBy(systemMutations.create_time, "DESC")
    .build();
}

/** Reads and starts the trace module's materialisations on the shared ClickHouse target. */
/** The active trace_analytics parts that lack at least one analytics metadata column. */
function partsMissingMetadataColumnsStatement() {
  const read = clickhouseRead({
    scope: tenantScope.allTenants({
      reason: "a part's stored columns belong to the shared table, which no tenant owns",
    }),
  });
  const wanted = param.strings([...ANALYTICS_METADATA_COLUMNS]);
  const lacking = read
    .from(systemPartsColumns)
    .select({ PartName: systemPartsColumns.name })
    .where(({ and, eq }) =>
      and(
        eq(systemPartsColumns.database, fn.currentDatabase()),
        eq(systemPartsColumns.table, "trace_analytics"),
        eq(systemPartsColumns.active, 1),
      ),
    )
    .groupBy(systemPartsColumns.name)
    .having(({ lt }) =>
      lt(fn.countIf(fn.has(wanted, systemPartsColumns.column)), fn.length(wanted)),
    )
    .as("lacking");
  return read
    .from(lacking)
    .select({ parts: fn.toUInt32(fn.count()) })
    .build();
}

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
      matching: cond.gt(
        fn.position(systemMutations.command, "MATERIALIZE INDEX idx_updated_at"),
        0,
      ),
    });
  }

  async findAnalyticsMetadataColumnMutations(): Promise<MaterialisationMutation[]> {
    // Whole column names, all nine: a substring would also match a longer name or a lone column.
    return this.mutationsOf({
      table: "trace_analytics",
      matching: fn.hasAll(
        fn.extractAll(systemMutations.command, "MATERIALIZE COLUMN ([A-Za-z0-9_]+)"),
        [...ANALYTICS_METADATA_COLUMNS],
      ),
    });
  }

  async countPartsMissingAnalyticsMetadataColumns(): Promise<number> {
    const { rows } = await this.#clickhouse.read({
      statement: partsMissingMetadataColumnsStatement(),
      table: "system.parts_columns",
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

  private async mutationsOf(input: {
    table: string;
    matching: Condition<"system.mutations">;
  }): Promise<MaterialisationMutation[]> {
    const { rows } = await this.#clickhouse.read({
      statement: mutationsStatement(input),
      table: "system.mutations",
    });
    return mutationRowsSchema.parse(rows);
  }
}
