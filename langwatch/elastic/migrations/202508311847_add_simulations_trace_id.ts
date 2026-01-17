import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { SCENARIO_EVENTS_INDEX } from "../../src/server/elasticsearch";
import { createIndex } from "../helpers";

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
