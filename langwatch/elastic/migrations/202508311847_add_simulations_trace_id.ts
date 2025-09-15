import { type Client as ElasticClient } from "@elastic/elasticsearch";
import { createIndex } from "../helpers";
import { SCENARIO_EVENTS_INDEX } from "../../src/server/elasticsearch";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  await createIndex({
    index: SCENARIO_EVENTS_INDEX.base,
    mappings: {
      messages: {
        properties: {
          trace_id: { type: "keyword" },
        },
      },
    },
    client,
  });
};
