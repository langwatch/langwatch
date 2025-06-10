import { BATCH_EVALUATION_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";

import { Client as ElasticClient } from "@elastic/elasticsearch";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: BATCH_EVALUATION_INDEX,
    client,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      dataset: {
        properties: {
          trace_id: { type: "keyword" },
        },
      },
    },
  });
};
