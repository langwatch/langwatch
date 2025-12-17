import { type Client as ElasticClient } from "@elastic/elasticsearch";
import { createIndex } from "../helpers";
import { SCENARIO_EVENTS_INDEX } from "../../src/server/elasticsearch";

/**
 * Adds a keyword subfield to metadata.name for sorting support.
 * This is a non-destructive change - only adds a new mapping.
 */
export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  await createIndex({
    index: SCENARIO_EVENTS_INDEX.base,
    mappings: {
      metadata: {
        properties: {
          name: {
            type: "text",
            fields: {
              keyword: { type: "keyword" },
            },
          },
        },
      },
    },
    client,
  });
};
