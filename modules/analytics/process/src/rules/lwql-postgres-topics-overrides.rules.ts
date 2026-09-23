/** The `topics` view — the proving slice for the opt-out Postgres catalog. */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-derivation.rules.ts";

/** The topics override, keyed by its Prisma model name. */
export const TOPICS_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
  Topic: {
    description: "One row per topic, with the name a trace's TopicId resolves to.",
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
      ParentTopicId: "Parent topic in the hierarchy, null for a top-level topic.",
    },
  },
};
