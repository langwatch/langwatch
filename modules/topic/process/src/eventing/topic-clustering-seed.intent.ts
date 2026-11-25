import { createLogger } from "@langwatch/observability";

import type { LegacyImportTopicClusteringMigration } from "../migrations/legacy-import.topic-clustering.migration.ts";

const logger = createLogger("langwatch:topic-clustering:seed");
const scheduleLogger = createLogger("langwatch:topic-clustering:schedule-seed");

export type TopicClusteringSeeds = Pick<
  LegacyImportTopicClusteringMigration,
  "seedTopicModelHistory" | "seedClusteringSchedules"
>;

/** A failed topic-model pass is logged and the next wake retries it, as main's next boot did. */
export function runTopicModelSeed(seeds: TopicClusteringSeeds): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      await seeds.seedTopicModelHistory();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Topic model seed pass failed; the next wake retries",
      );
    }
  };
}

/** A failed schedule pass is logged and the next wake retries it, as main's next boot did. */
export function runClusteringScheduleSeed(seeds: TopicClusteringSeeds): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      await seeds.seedClusteringSchedules();
    } catch (error) {
      scheduleLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Topic clustering schedule seed failed; the next wake retries",
      );
    }
  };
}
