import { esClient, TRACE_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

import { Client as ElasticClient } from "@elastic/elasticsearch";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: TRACE_INDEX,
    client,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      retention_policy: { type: "keyword" },
      retention_holdouts: { type: "keyword" },
    },
  });
};
