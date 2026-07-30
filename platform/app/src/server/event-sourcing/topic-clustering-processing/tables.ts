import { ch, defineTable, replacing } from "@langwatch/clickhouse";
import { runHistoryStateSchema } from "./projections/runHistory";
import { runStatusStateSchema } from "./projections/runStatus";
import { topicModelStateSchema } from "./projections/topicModel";

/**
 * ClickHouse table declarations for this pipeline's three folds (ADR-099).
 *
 * === These are NEW tables, not a description of deployed DDL ===
 *
 * Unlike `log-processing/table.ts` and `simulation-processing/table.ts`,
 * which describe tables that already exist (`log_records`,
 * `simulation_runs`), the old topic-clustering-processing pipeline's three
 * read models (`TopicClusteringRunStatusFoldProjection`,
 * `TopicClusteringRunHistoryFoldProjection`, `TopicModelFoldProjection`)
 * were stored in **Postgres** (`StateProjectionStore`, injected — see the
 * old pipeline's `pipeline.ts` deps interface: "Postgres run-status read
 * model behind the settings page", "Postgres run-history read model",
 * "Write-through store for the topic model (the Topic table + cursor)").
 * There is no deployed ClickHouse DDL to transcribe. Every column, sort
 * key, and partition choice below is therefore this rewrite's own proposal
 * for the target shape, not a fact about production — flagged, not
 * silently assumed, per this task's instruction to flag rather than guess.
 *
 * **Two open questions this file does not resolve** (out of scope: "touch
 * only your pipeline's directory", and both are decisions with a blast
 * radius outside it):
 *
 * 1. **Whether these three read models should move off Postgres at all.**
 *    The topic-model projection's whole job is to be the Postgres `Topic`
 *    table's write-through store — "the Topic table + cursor" — and other
 *    application code (the settings UI, and anything that joins against
 *    `Topic` via Prisma) reads that table directly today, outside this
 *    event-sourcing pipeline entirely. Declaring a ClickHouse table here
 *    does not migrate those readers, and this rewrite does not touch them.
 *    If this pipeline is wired to the stores below without also migrating
 *    those call sites, they silently stop seeing new data. ADR-099 reserves
 *    Postgres for exactly one documented case today (Langy conversation
 *    state) — a Postgres `ReplaceStore` adapter for this pipeline's three
 *    folds would match that precedent and require no reader migration, and
 *    is the lower-risk option if the answer to "do we actually want to
 *    move this" is not already "yes" from someone who owns that surface.
 * 2. **No migration exists yet.** Even granting the move to ClickHouse,
 *    these three tables are not deployed. `simulation-processing/table.ts`
 *    sets the precedent for naming this rather than working around it: a
 *    required column with no deployed home is stated as "requires a
 *    follow-up migration", not invented into an ALTER this rewrite cannot
 *    run from a pipeline directory.
 *
 * Given both of those, the fold definitions in `projections/*.ts` are
 * written against `@langwatch/event-sourcing`'s `ReplaceStore<State>`
 * INTERFACE — never against a concrete store built from the tables below —
 * so this file is read as "the shape a ClickHouse-backed store for these
 * folds would need", available for whoever resolves question 1, and does
 * not make that resolution on this pipeline's behalf.
 */

export const topicClusteringRunStatusTable = defineTable({
  name: "topic_clustering_run_status",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "ProjectId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    ProjectId: ch.string(),
    State: ch.json(runStatusStateSchema),
    DeliverySeq: ch.uint64(),
    StateVersion: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
  },
});

export const topicClusteringRunHistoryTable = defineTable({
  name: "topic_clustering_run_history",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "ProjectId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    ProjectId: ch.string(),
    State: ch.json(runHistoryStateSchema),
    DeliverySeq: ch.uint64(),
    StateVersion: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
  },
});

export const topicModelTable = defineTable({
  name: "topic_clustering_topic_model",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "ProjectId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    ProjectId: ch.string(),
    State: ch.json(topicModelStateSchema),
    DeliverySeq: ch.uint64(),
    StateVersion: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
  },
});
