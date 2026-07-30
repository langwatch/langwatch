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
 * NONE OF THE THREE IS DEPLOYED — no migration creates any of them, so every
 * write through these stores fails. All three read models live in Postgres
 * today (`topic.prisma.repository.ts`, `routers/topics.ts`), and the topic
 * model is the write-through store behind the `Topic` table the settings UI and
 * every Prisma join read, so moving them to ClickHouse is a reader migration
 * before it is a table migration. Declared here as the shape those tables would
 * take, and mounted by `index.ts` — which is what makes this a defect rather
 * than a sketch.
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
