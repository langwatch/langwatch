import { BATCH_EVALUATION_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

import { Client as ElasticClient } from "@elastic/elasticsearch";

/**
 * Migration to add target_id field to batch_evaluations index.
 * This supports Evaluations V3 which can have multiple targets per evaluation.
 * The target_id field allows tracking which target produced each result.
 */
export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: BATCH_EVALUATION_INDEX,
    client,
  });

  // Add target_id to dataset entries
  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      dataset: {
        properties: {
          target_id: { type: "keyword" },
        },
      },
    },
  });

  // Add target_id to evaluations (nested type)
  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      evaluations: {
        type: "nested",
        properties: {
          target_id: { type: "keyword" },
        },
      },
    },
  });
};
