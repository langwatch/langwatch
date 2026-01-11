import { BATCH_EVALUATION_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

import { Client as ElasticClient } from "@elastic/elasticsearch";

/**
 * Migration to add targets metadata field to batch_evaluations index.
 * This supports Evaluations V3 which stores target configuration at execution time
 * so we can display results even after targets are modified or deleted.
 */
export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: BATCH_EVALUATION_INDEX,
    client,
  });

  // Add targets nested field
  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      targets: {
        type: "nested",
        properties: {
          id: { type: "keyword" },
          name: { type: "keyword" },
          type: { type: "keyword" },
          prompt_id: { type: "keyword" },
          prompt_version: { type: "integer" },
          agent_id: { type: "keyword" },
          model: { type: "keyword" },
        },
      },
    },
  });
};
