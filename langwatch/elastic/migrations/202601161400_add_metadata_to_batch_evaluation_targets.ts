import { BATCH_EVALUATION_INDEX, FLATENNED_TYPE } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

import { Client as ElasticClient } from "@elastic/elasticsearch";

/**
 * Migration to add metadata field to batch_evaluations targets.
 * This supports flexible key-value metadata for targets, enabling
 * comparison across different models, prompts, temperatures, etc.
 */
export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: BATCH_EVALUATION_INDEX,
    client,
  });

  // Update the targets nested field to include metadata
  // Note: We need to re-specify all properties when updating a nested field
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
          metadata: { type: FLATENNED_TYPE } as { type: "flattened" },
        },
      },
    },
  });
};
