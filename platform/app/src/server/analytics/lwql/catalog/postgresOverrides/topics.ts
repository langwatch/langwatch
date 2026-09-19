/**
 * The `topics` view — the proving slice for the opt-out Postgres catalog.
 *
 * A trace records a `TopicId`; this view is where that id resolves to a name.
 * The clustering internals that produced the topic (its centroid vector, the
 * embedding model, the 95th-percentile distance, the last event consumed) are
 * not customer data, so they are stripped with a reason rather than gated. The
 * self-referential parent is exposed as `ParentTopicId` so a caller can walk
 * the topic tree.
 *
 * @see ../derivePostgresCatalog.ts — the derivation this refines
 * @see specs/lwql/postgres-catalog.feature — "Topic clustering internals are not exposed"
 */

import type { PostgresDatasetOverride } from "../derivePostgresCatalog";

/** The topics override, keyed by its Prisma model name. */
export const TOPICS_POSTGRES_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = {
  Topic: {
    description:
      "One row per topic, with the name a trace's TopicId resolves to.",
    aliases: { TopicName: "name", ParentTopicId: "parentId" },
    skipColumns: {
      centroid: "clustering internal, not customer data",
      embeddings_model: "clustering internal, not customer data",
      p95Distance: "clustering internal, not customer data",
      lastEventId: "clustering internal, not customer data",
    },
    descriptions: {
      TopicId: "Topic identifier. Matches `traces.TopicId`.",
      TopicName: "Display name of the topic.",
      ParentTopicId:
        "Parent topic in the hierarchy, null for a top-level topic.",
    },
  },
};
