import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { SCENARIO_EVENTS_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

/**
 * Adds a keyword subfield to metadata.name for sorting support.
 * This is a non-destructive change - only adds a new mapping.
 */
export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: SCENARIO_EVENTS_INDEX,
    client,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      name: {
        type: "text",
        fields: {
          keyword: { type: "keyword" },
        },
      },
    },
  });
};
