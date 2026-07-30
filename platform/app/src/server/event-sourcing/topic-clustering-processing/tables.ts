import type {
  ColumnDef,
  RowMapping,
  TableDefinition,
} from "@langwatch/clickhouse";
import { ch, defineTable, replacing } from "@langwatch/clickhouse";
import type { z } from "zod";
import { runHistoryStateSchema } from "./projections/runHistory";
import { runStatusStateSchema } from "./projections/runStatus";
import { topicModelStateSchema } from "./projections/topicModel";

/**
 * The three fold tables, one row per project each.
 *
 * These are proposals, not transcriptions of deployed DDL: the old pipeline
 * kept all three read models in Postgres, and the topic-model one is the
 * write-through store behind the Postgres `Topic` table that the settings UI
 * and every Prisma join still read. Wiring these folds to ClickHouse without
 * migrating those readers would silently stop them seeing new data, so the
 * choice — and the migration it needs — is left open.
 */

/** The whole fold state lands in one JSON column, so the state is not a
 * case-shift of the row and the mapping is declared rather than derived. */
export type FoldStateColumns<State> = {
  TenantId: ColumnDef<string>;
  ProjectId: ColumnDef<string>;
  State: ColumnDef<State>;
  StateVersion: ColumnDef<string>;
  AcceptedAt: ColumnDef<Date>;
  UpdatedAt: ColumnDef<Date>;
};

function foldStateTable<State>(
  name: string,
  state: z.ZodType<State>,
): TableDefinition<FoldStateColumns<State>> {
  return defineTable({
    name,
    merge: replacing({ version: "UpdatedAt" }),
    sortKey: ["TenantId", "ProjectId"],
    partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
    tenant: ["TenantId"],
    ttl: { anchor: "AcceptedAt" },
    columns: {
      TenantId: ch.string(),
      ProjectId: ch.string(),
      State: ch.json(state),
      StateVersion: ch.string(),
      AcceptedAt: ch.acceptedAt(),
      UpdatedAt: ch.writtenAt(),
    },
  });
}

export function foldStateRow<State>(): RowMapping<
  State,
  FoldStateColumns<State>
> {
  return {
    toRow: (state, context) => ({
      TenantId: context.tenantId,
      ProjectId: context.key,
      State: state,
      StateVersion: context.version,
      AcceptedAt: context.writtenAt,
      UpdatedAt: context.writtenAt,
    }),
    fromRow: (row) => row.State,
  };
}

export const topicClusteringRunStatusTable = foldStateTable(
  "topic_clustering_run_status",
  runStatusStateSchema,
);

export const topicClusteringRunHistoryTable = foldStateTable(
  "topic_clustering_run_history",
  runHistoryStateSchema,
);

export const topicModelTable = foldStateTable(
  "topic_clustering_topic_model",
  topicModelStateSchema,
);
